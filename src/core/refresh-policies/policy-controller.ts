import { createPolicyTimer } from "./timer";
import { isDataNode } from "../graph/node-guards";
import { GraphExecutionError, toError } from "../execution/types";

import type { GraphDiagnosticRefreshPolicySnapshot } from "../diagnostics/snapshot";
import type { AnyNodeDefinition, DataNodeDefinition, Graph } from "../graph/types";
import type { NodeStateRecord } from "../state/state";
import type { TimerEnvironment } from "../timer-environment";
import {
  GraphPollingConditionError,
  GraphPollingTimeoutError,
  GraphRefreshRetryExhaustedError,
} from "./errors";
import type { PollUntilPolicy, RetryPolicy } from "./types";

type PolicyDataNode = DataNodeDefinition<unknown, readonly AnyNodeDefinition[]>;

type TimerPurpose = "refresh" | "retry";

interface RefreshPolicySession {
  generation: number | undefined;
  succeededAt: number | undefined;
  readonly timer: ReturnType<typeof createPolicyTimer<TimerPurpose>>;
  refreshing: boolean;
  policyRefreshSucceeded: boolean;
  pollingStartedAt: number | undefined;
  evaluatedGeneration: number | undefined;
  terminal: boolean;
  retryCount: number;
}

export interface RuntimeRefreshPolicyController {
  readonly reconcile: () => void;
  readonly getDiagnosticSnapshot: () => readonly GraphDiagnosticRefreshPolicySnapshot[];
  /**
   * Permanently stops the controller: clears every pending timer, detaches
   * from the timer environment's pause signal, and turns `reconcile` and any
   * in-flight policy refresh's follow-up work into no-ops. Idempotent.
   * `getDiagnosticSnapshot` stays safe to call afterwards.
   */
  readonly dispose: () => void;
}

export interface RuntimeRefreshPolicyDependencies {
  readonly graph: Graph;
  readonly environment: TimerEnvironment;
  readonly getNodeState: (key: string) => NodeStateRecord;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  readonly refreshPolicyNode: (node: PolicyDataNode) => Promise<void>;
  readonly failPolicyNode: (node: PolicyDataNode, generation: number, error: Error) => void;
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

const isPolicyDataNode = (node: AnyNodeDefinition): node is PolicyDataNode => {
  if (!isDataNode(node)) return false;
  const policy = node.refresh;
  return (
    policy?.kind === "stale-after" || policy?.kind === "interval" || policy?.kind === "poll-until"
  );
};

const getPolicyFailure = (error: unknown, nodeKey: string): Error => {
  if (error instanceof GraphExecutionError) {
    const cause = error.failures.find((failure) => failure.nodeKey === nodeKey)?.error;
    if (cause) return cause;
  }
  return toError(error);
};

const calculateRetryDelay = (
  retry: RetryPolicy,
  retryIndex: number,
  random: () => number,
): number => {
  const baseDelay =
    retry.strategy === "fixed"
      ? retry.delayMs
      : Math.min(retry.initialDelayMs * retry.multiplier ** retryIndex, retry.maxDelayMs);
  if (retry.jitterRatio === 0) return Math.round(baseDelay);
  const factor = 1 - retry.jitterRatio + 2 * retry.jitterRatio * random();
  return Math.max(0, Math.round(baseDelay * factor));
};

export const createRuntimeRefreshPolicyController = ({
  graph,
  environment,
  getNodeState,
  hasSubscribers,
  refreshPolicyNode,
  failPolicyNode,
  onDiagnostic,
}: RuntimeRefreshPolicyDependencies): RuntimeRefreshPolicyController => {
  const sessions = new Map<string, RefreshPolicySession>();
  let disposed = false;
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
      timer: createPolicyTimer<TimerPurpose>(environment),
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

  const resetSession = (session: RefreshPolicySession): void => {
    session.timer.clear();
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
    session.timer.clear();
    session.terminal = true;
  };

  const getNormalDelay = (node: PolicyDataNode, succeededAt: number): number | undefined => {
    const policy = node.refresh;
    if (policy?.kind === "stale-after") {
      return Math.max(0, policy.durationMs - (environment.now() - succeededAt));
    }
    if (policy?.kind === "interval" || policy?.kind === "poll-until") {
      return policy.intervalMs;
    }
    return undefined;
  };

  const evaluatePollingResult = (
    node: PolicyDataNode,
    policy: PollUntilPolicy<unknown>,
    state: NodeStateRecord,
    session: RefreshPolicySession,
  ): boolean => {
    if (session.evaluatedGeneration === state.generation) {
      return !session.terminal;
    }
    session.evaluatedGeneration = state.generation;

    try {
      if (policy.failWhen?.(state.data)) {
        completeSession(session);
        failPolicyNode(node, state.generation, new GraphPollingConditionError(node.key));
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
          { cause },
        ),
      );
      return false;
    }

    const startedAt = session.pollingStartedAt;
    if (startedAt !== undefined && activeNow() - startedAt >= policy.timeoutMs) {
      completeSession(session);
      failPolicyNode(
        node,
        state.generation,
        new GraphPollingTimeoutError(node.key, policy.timeoutMs),
      );
      return false;
    }

    return true;
  };

  const startPolicyRefresh = (node: PolicyDataNode, session: RefreshPolicySession): void => {
    if (disposed || paused || session.refreshing || session.terminal) return;
    session.refreshing = true;
    onDiagnostic?.("started", node);
    let succeeded = false;
    void refreshPolicyNode(node)
      .then(() => {
        succeeded = true;
      })
      .catch((error) => {
        if (disposed) return;
        onDiagnostic?.("failed", node, {
          error: getPolicyFailure(error, node.key),
        });
        const retry = node.refresh?.kind === "stale-after" ? undefined : node.refresh?.retry;
        if (!retry) return;

        if (session.retryCount < retry.maxRetries) {
          const delayMs = calculateRetryDelay(retry, session.retryCount, environment.random);
          session.retryCount += 1;
          session.timer.defer(delayMs, "retry");
          onDiagnostic?.("retry-scheduled", node, { delayMs });
          return;
        }

        const state = getNodeState(node.key);
        session.generation = state.generation;
        completeSession(session);
        failPolicyNode(
          node,
          state.generation,
          new GraphRefreshRetryExhaustedError(
            node.key,
            session.retryCount + 1,
            getPolicyFailure(error, node.key),
          ),
        );
      })
      .finally(() => {
        session.refreshing = false;
        if (disposed) return;
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
    purpose: TimerPurpose,
  ): void => {
    if (disposed) return;
    session.timer.defer(delayMs, purpose);
    onDiagnostic?.(purpose === "retry" ? "retry-scheduled" : "scheduled", node, { delayMs });
    if (paused) return;
    session.timer.resume((timerPurpose) => {
      if (disposed) return;
      const current = getNodeState(node.key);
      const canRefresh =
        hasSubscribers(node) &&
        !paused &&
        !session.terminal &&
        (timerPurpose === "retry" ||
          (current.status === "success" &&
            current.freshness === "fresh" &&
            current.hasSuccessfulValue));
      if (canRefresh) startPolicyRefresh(node, session);
    });
  };

  function reconcileNode(node: PolicyDataNode): void {
    if (disposed) return;
    const state = getNodeState(node.key);
    const session = getSession(node.key);
    const policy = node.refresh;

    if (!hasSubscribers(node)) {
      if (policy?.kind === "stale-after") {
        session.timer.clear();
      } else {
        resetSession(session);
      }
      return;
    }

    // A terminal result belongs to one generation, not every future job.
    if (session.terminal && session.generation !== state.generation) resetSession(session);
    if (session.terminal || session.refreshing) return;

    const pending = session.timer.getState();
    if (pending.status === "pending" && pending.purpose === "retry") {
      schedule(node, session, pending.remainingDelayMs, "retry");
      return;
    }

    const isFreshSuccess =
      state.status === "success" && state.freshness === "fresh" && state.hasSuccessfulValue;

    if (!isFreshSuccess) {
      session.timer.clear();
      return;
    }

    const continuedPollingCycle = policy?.kind === "poll-until" && session.policyRefreshSucceeded;
    session.policyRefreshSucceeded = false;

    if (session.generation !== state.generation || session.succeededAt === undefined) {
      session.timer.clear();
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

    const timer = session.timer.getState();
    if (timer.status === "armed") return;
    if (timer.status === "pending") {
      schedule(node, session, timer.remainingDelayMs, timer.purpose);
      return;
    }

    const succeededAt = session.succeededAt;
    if (succeededAt === undefined) return;
    const delayMs = getNormalDelay(node, succeededAt);
    if (delayMs !== undefined) schedule(node, session, delayMs, "refresh");
  }

  const policyNodes = graph.getNodes().filter(isPolicyDataNode);
  const reconcile = (): void => {
    for (const node of policyNodes) reconcileNode(node);
  };

  const unsubscribePauseChange = environment.onPauseChange((nextPaused) => {
    if (disposed || nextPaused === paused) return;
    if (nextPaused) {
      paused = true;
      pausedAt = environment.now();
      onDiagnostic?.("paused", undefined);
      for (const session of sessions.values()) {
        session.timer.pause();
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

  const getDiagnosticSnapshot = (): readonly GraphDiagnosticRefreshPolicySnapshot[] =>
    Object.freeze(
      policyNodes.map((node) => {
        const session = getSession(node.key);
        const timer = session.timer.getState();
        return Object.freeze({
          key: node.key,
          kind: node.refresh?.kind ?? "stale-after",
          refreshing: session.refreshing,
          terminal: session.terminal,
          retryCount: session.retryCount,
          ...(timer.status === "idle" ? {} : { timerPurpose: timer.purpose }),
          ...(timer.status === "armed" ? { timerDueAt: timer.dueAt } : {}),
          ...(timer.status === "pending" ? { remainingDelayMs: timer.remainingDelayMs } : {}),
        });
      }),
    );

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribePauseChange();
    for (const session of sessions.values()) session.timer.clear();
  };

  return Object.freeze({ reconcile, getDiagnosticSnapshot, dispose });
};
