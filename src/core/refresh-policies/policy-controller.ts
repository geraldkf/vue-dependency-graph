import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  Graph,
} from "../graph/types";
import type { MutableNodeRuntimeState } from "../state/state";
import {
  GraphPollingConditionError,
  GraphPollingTimeoutError,
} from "./errors";
import type {
  PollUntilPolicy,
  RefreshPolicyEnvironment,
} from "./types";

type PolicyDataNode = DataNodeDefinition<
  unknown,
  readonly AnyNodeDefinition[]
>;

interface RefreshPolicySession {
  generation: number | undefined;
  succeededAt: number | undefined;
  timer: unknown | undefined;
  token: number;
  refreshing: boolean;
  policyRefreshSucceeded: boolean;
  pollingStartedAt: number | undefined;
  evaluatedGeneration: number | undefined;
  terminal: boolean;
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

export const createRuntimeRefreshPolicyController = ({
  graph,
  environment,
  getMutableState,
  hasSubscribers,
  refreshPolicyNode,
  failPolicyNode,
}: RuntimeRefreshPolicyDependencies): RuntimeRefreshPolicyController => {
  const sessions = new Map<string, RefreshPolicySession>();

  const getSession = (key: string): RefreshPolicySession => {
    const existing = sessions.get(key);
    if (existing) return existing;
    const created: RefreshPolicySession = {
      generation: undefined,
      succeededAt: undefined,
      timer: undefined,
      token: 0,
      refreshing: false,
      policyRefreshSucceeded: false,
      pollingStartedAt: undefined,
      evaluatedGeneration: undefined,
      terminal: false,
    };
    sessions.set(key, created);
    return created;
  };

  const clearTimer = (session: RefreshPolicySession): void => {
    session.token += 1;
    if (session.timer !== undefined) {
      environment.clearTimeout(session.timer);
      session.timer = undefined;
    }
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
  };

  const completeSession = (session: RefreshPolicySession): void => {
    clearTimer(session);
    session.terminal = true;
  };

  const getDelayMs = (
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
      environment.now() - startedAt >= policy.timeoutMs
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

  const reconcileNode = (node: PolicyDataNode): void => {
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

    const isFreshSuccess =
      state.status === "success" &&
      state.freshness === "fresh" &&
      state.hasSuccessfulValue;

    if (!isFreshSuccess) {
      clearTimer(session);
      if (!session.refreshing) resetSession(session);
      return;
    }

    if (session.refreshing) return;

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
      if (policy?.kind === "poll-until" && !continuedPollingCycle) {
        session.pollingStartedAt = environment.now();
        session.evaluatedGeneration = undefined;
      }
    }

    if (policy?.kind === "poll-until") {
      if (session.terminal) return;
      if (!evaluatePollingResult(node, policy, state, session)) return;
    }

    if (session.timer !== undefined) return;
    const succeededAt = session.succeededAt;
    if (succeededAt === undefined) return;
    const delayMs = getDelayMs(node, succeededAt);
    if (delayMs === undefined) return;

    const token = session.token + 1;
    const generation = state.generation;
    session.token = token;
    session.timer = environment.setTimeout(() => {
      if (session.token !== token) return;
      session.timer = undefined;

      const current = getMutableState(node.key);
      if (
        current.generation !== generation ||
        current.status !== "success" ||
        current.freshness !== "fresh" ||
        !current.hasSuccessfulValue ||
        !hasSubscribers(node) ||
        session.terminal
      ) {
        return;
      }

      session.refreshing = true;
      let succeeded = false;
      void refreshPolicyNode(node)
        .then(() => {
          succeeded = true;
        })
        .catch(() => undefined)
        .finally(() => {
          session.refreshing = false;
          session.policyRefreshSucceeded = succeeded;
          reconcileNode(node);
        });
    }, delayMs);
  };

  const policyNodes = graph.getNodes().filter(isPolicyDataNode);
  const reconcile = (): void => {
    for (const node of policyNodes) reconcileNode(node);
  };

  return Object.freeze({ reconcile });
};
