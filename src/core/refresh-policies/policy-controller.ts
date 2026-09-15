import { GraphExecutionError, toError } from "../execution/types";
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  Graph,
} from "../graph/types";
import type { MutableNodeRuntimeState } from "../state/state";
import {
  GraphPollingConditionError,
  GraphPollingTimeoutError,
  GraphRefreshRetryExhaustedError,
} from "./errors";
import type {
  PollUntilPolicy,
  RefreshPolicyEnvironment,
  RetryPolicy,
} from "./types";

type PolicyDataNode = DataNodeDefinition<
  unknown,
  readonly AnyNodeDefinition[]
>;

type TimerPurpose = "refresh" | "retry";

interface RefreshPolicySession {
  generation: number | undefined;
  succeededAt: number | undefined;
  timer: unknown | undefined;
  timerDueAt: number | undefined;
  timerPurpose: TimerPurpose | undefined;
  remainingDelayMs: number | undefined;
  token: number;
  refreshing: boolean;
  policyRefreshSucceeded: boolean;
  pollingStartedAt: number | undefined;
  evaluatedGeneration: number | undefined;
  terminal: boolean;
  retryCount: number;
}

export interface RuntimeRefreshPolicyController {
  readonly reconcile: () => void;
}

export interface RuntimeRefreshPolicyDependencies {
  readonly graph: Graph;
  readonly environment: RefreshPolicyEnvironment;
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  readonly refreshPolicyNode: (node: PolicyDataNode) => Promise<void>;
  readonly failPolicyNode: (
    node: PolicyDataNode,
    generation: number,
    error: Error
  ) => void;
  readonly onDiagnostic?: (
    type:
      | "scheduled"
      | "started"
      | "retry-scheduled"
      | "completed"
      | "failed"
      | "paused"
      | "resumed"
      | "stopped",
    node: PolicyDataNode | undefined,
    details?: { readonly delayMs?: number; readonly error?: Error },
  ) => void;
}

const isPolicyDataNode = (
  node: AnyNodeDefinition
): node is PolicyDataNode => {
  if (node.kind !== "data") return false;
  const policy = (node as PolicyDataNode).refresh;
  return (
    policy?.kind === "stale-after" ||
    policy?.kind === "interval" ||
    policy?.kind === "poll-until"
  );
};

const getPolicyFailure = (error: unknown, nodeKey: string): Error => {
  if (error instanceof GraphExecutionError) {
    const cause = error.failures.find(failure => failure.nodeKey === nodeKey)?.error;
    if (cause) return cause;
  }
  return toError(error);
};

const calculateRetryDelay = (
  retry: RetryPolicy,
  retryIndex: number,
  random: () => number
): number => {
  const baseDelay =
    retry.strategy === "fixed"
      ? retry.delayMs
      : Math.min(
          retry.initialDelayMs * retry.multiplier ** retryIndex,
          retry.maxDelayMs
        );
  if (retry.jitterRatio === 0) return Math.round(baseDelay);
  const factor =
    1 - retry.jitterRatio + 2 * retry.jitterRatio * random();
  return Math.max(0, Math.round(baseDelay * factor));
};

export const createRuntimeRefreshPolicyController = ({
  graph,
  environment,
  getMutableState,
  hasSubscribers,
  refreshPolicyNode,
  failPolicyNode,
  onDiagnostic,
}: RuntimeRefreshPolicyDependencies): RuntimeRefreshPolicyController => {
  const sessions = new Map<string, RefreshPolicySession>();
  let paused = environment.isPaused();
  let pausedAt = paused ? environment.now() : undefined;
  let totalPausedMs = 0;

  const activeNow = (): number => {
    const current = environment.now();
    const currentPause = pausedAt === undefined ? 0 : current - pausedAt;
    return current - totalPausedMs - currentPause;
  };

  const getSession = (key: string): RefreshPolicySession => {
    const existing = sessions.get(key);
    if (existing) return existing;
    const created: RefreshPolicySession = {
      generation: undefined,
      succeededAt: undefined,
      timer: undefined,
      timerDueAt: undefined,
      timerPurpose: undefined,
      remainingDelayMs: undefined,
      token: 0,
      refreshing: false,
      policyRefreshSucceeded: false,
      pollingStartedAt: undefined,
      evaluatedGeneration: undefined,
      terminal: false,
      retryCount: 0,
    };
    sessions.set(key, created);
    return created;
  };

  const clearTimer = (
    session: RefreshPolicySession,
    preserveRemaining = false
  ): void => {
    session.token += 1;
    if (
      preserveRemaining &&
      session.timerDueAt !== undefined &&
      session.timerPurpose !== undefined
    ) {
      session.remainingDelayMs = Math.max(
        0,
        session.timerDueAt - environment.now()
      );
    } else if (!preserveRemaining) {
      session.remainingDelayMs = undefined;
      session.timerPurpose = undefined;
    }
    if (session.timer !== undefined) {
      environment.clearTimeout(session.timer);
    }
    session.timer = undefined;
    session.timerDueAt = undefined;
  };

  const resetSession = (session: RefreshPolicySession): void => {
    clearTimer(session);
    session.generation = undefined;
    session.succeededAt = undefined;
    session.refreshing = false;
    session.policyRefreshSucceeded = false;
    session.pollingStartedAt = undefined;
    session.evaluatedGeneration = undefined;
    session.terminal = false;
    session.retryCount = 0;
  };

  const completeSession = (session: RefreshPolicySession): void => {
    clearTimer(session);
    session.terminal = true;
  };

  const getNormalDelay = (
    node: PolicyDataNode,
    succeededAt: number
  ): number | undefined => {
    const policy = node.refresh;
    if (policy?.kind === "stale-after") {
      return Math.max(
        0,
        policy.durationMs - (environment.now() - succeededAt)
      );
    }
    if (policy?.kind === "interval" || policy?.kind === "poll-until") {
      return policy.intervalMs;
    }
    return undefined;
  };

  const evaluatePollingResult = (
    node: PolicyDataNode,
    policy: PollUntilPolicy<unknown>,
    state: MutableNodeRuntimeState,
    session: RefreshPolicySession
  ): boolean => {
    if (session.evaluatedGeneration === state.generation) {
      return !session.terminal;
    }
    session.evaluatedGeneration = state.generation;

    try {
      if (policy.failWhen?.(state.data)) {
        completeSession(session);
        failPolicyNode(
          node,
          state.generation,
          new GraphPollingConditionError(node.key)
        );
        return false;
      }
      if (policy.stopWhen(state.data)) {
        completeSession(session);
        return false;
      }
    } catch (cause) {
      completeSession(session);
      failPolicyNode(
        node,
        state.generation,
        new GraphPollingConditionError(
          node.key,
          `Polling predicate for node "${node.key}" failed.`,
          { cause }
        )
      );
      return false;
    }

    const startedAt = session.pollingStartedAt;
    if (
      startedAt !== undefined &&
      activeNow() - startedAt >= policy.timeoutMs
    ) {
      completeSession(session);
      failPolicyNode(
        node,
        state.generation,
        new GraphPollingTimeoutError(node.key, policy.timeoutMs)
      );
      return false;
    }

    return true;
  };

  let reconcileNode: (node: PolicyDataNode) => void;

  const startPolicyRefresh = (
    node: PolicyDataNode,
    session: RefreshPolicySession
  ): void => {
    if (paused || session.refreshing || session.terminal) return;
    session.refreshing = true;
    onDiagnostic?.("started", node);
    let succeeded = false;
    void refreshPolicyNode(node)
      .then(() => {
        succeeded = true;
      })
      .catch(error => {
        onDiagnostic?.("failed", node, {
          error: getPolicyFailure(error, node.key),
        });
        const retry =
          node.refresh?.kind === "stale-after"
            ? undefined
            : node.refresh?.retry;
        if (!retry) return;

        if (session.retryCount < retry.maxRetries) {
          const delayMs = calculateRetryDelay(
            retry,
            session.retryCount,
            environment.random
          );
          session.retryCount += 1;
          session.remainingDelayMs = delayMs;
          session.timerPurpose = "retry";
          onDiagnostic?.("retry-scheduled", node, { delayMs });
          return;
        }

        completeSession(session);
        const state = getMutableState(node.key);
        failPolicyNode(
          node,
          state.generation,
          new GraphRefreshRetryExhaustedError(
            node.key,
            session.retryCount + 1,
            getPolicyFailure(error, node.key)
          )
        );
      })
      .finally(() => {
        session.refreshing = false;
        session.policyRefreshSucceeded = succeeded;
        if (succeeded) {
          session.retryCount = 0;
          onDiagnostic?.("completed", node);
        }
        reconcileNode(node);
      });
  };

  const schedule = (
    node: PolicyDataNode,
    session: RefreshPolicySession,
    delayMs: number,
    purpose: TimerPurpose
  ): void => {
    session.timerPurpose = purpose;
    session.remainingDelayMs = delayMs;
    onDiagnostic?.(purpose === "retry" ? "retry-scheduled" : "scheduled", node, {
      delayMs,
    });
    if (paused || session.timer !== undefined) return;

    const token = session.token + 1;
    session.token = token;
    session.remainingDelayMs = undefined;
    session.timerDueAt = environment.now() + delayMs;
    session.timer = environment.setTimeout(() => {
      if (session.token !== token) return;
      session.timer = undefined;
      session.timerDueAt = undefined;
      session.timerPurpose = undefined;

      const current = getMutableState(node.key);
      const canRefresh =
        hasSubscribers(node) &&
        !paused &&
        !session.terminal &&
        (purpose === "retry" ||
          (current.status === "success" &&
            current.freshness === "fresh" &&
            current.hasSuccessfulValue));
      if (canRefresh) startPolicyRefresh(node, session);
    }, delayMs);
  };

  reconcileNode = (node: PolicyDataNode): void => {
    const state = getMutableState(node.key);
    const session = getSession(node.key);
    const policy = node.refresh;

    if (!hasSubscribers(node)) {
      if (policy?.kind === "stale-after") {
        clearTimer(session);
      } else {
        resetSession(session);
      }
      return;
    }

    if (session.terminal || session.refreshing) return;

    if (
      session.timerPurpose === "retry" &&
      session.remainingDelayMs !== undefined
    ) {
      schedule(node, session, session.remainingDelayMs, "retry");
      return;
    }

    const isFreshSuccess =
      state.status === "success" &&
      state.freshness === "fresh" &&
      state.hasSuccessfulValue;

    if (!isFreshSuccess) {
      clearTimer(session);
      return;
    }

    const continuedPollingCycle =
      policy?.kind === "poll-until" && session.policyRefreshSucceeded;
    session.policyRefreshSucceeded = false;

    if (
      session.generation !== state.generation ||
      session.succeededAt === undefined
    ) {
      clearTimer(session);
      session.generation = state.generation;
      session.succeededAt = environment.now();
      session.terminal = false;
      session.retryCount = 0;
      if (policy?.kind === "poll-until" && !continuedPollingCycle) {
        session.pollingStartedAt = activeNow();
        session.evaluatedGeneration = undefined;
      }
    }

    if (policy?.kind === "poll-until") {
      if (!evaluatePollingResult(node, policy, state, session)) return;
    }

    if (session.timer !== undefined) return;
    if (session.remainingDelayMs !== undefined) {
      schedule(
        node,
        session,
        session.remainingDelayMs,
        session.timerPurpose ?? "refresh"
      );
      return;
    }

    const succeededAt = session.succeededAt;
    if (succeededAt === undefined) return;
    const delayMs = getNormalDelay(node, succeededAt);
    if (delayMs !== undefined) schedule(node, session, delayMs, "refresh");
  };

  const policyNodes = graph.getNodes().filter(isPolicyDataNode);
  const reconcile = (): void => {
    for (const node of policyNodes) reconcileNode(node);
  };

  environment.onPauseChange(nextPaused => {
    if (nextPaused === paused) return;
    if (nextPaused) {
      paused = true;
      pausedAt = environment.now();
      onDiagnostic?.("paused", undefined);
      for (const session of sessions.values()) {
        clearTimer(session, true);
      }
      return;
    }

    if (pausedAt !== undefined) {
      totalPausedMs += environment.now() - pausedAt;
    }
    pausedAt = undefined;
    paused = false;
    onDiagnostic?.("resumed", undefined);
    reconcile();
  });

  return Object.freeze({ reconcile });
};
