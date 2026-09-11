import type {
  NodeSubscription,
  NodeSubscriptionState,
} from "./subscription";
import type { SchedulerState } from "./scheduler";
import {
  GraphExecutionError,
  type NodeExecutionFailure,
  isAbortError,
  toError,
} from "./execution";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
  Graph,
  NodeValue,
} from "./types";

export type NodeStatus =
  | "idle"
  | "loading"
  | "success"
  | "refreshing"
  | "error";

export type NodeFreshness = "fresh" | "stale";

export type RuntimeNodeData<TNode extends AnyNodeDefinition> =
  TNode["kind"] extends "derived"
    ? NodeValue<TNode> | undefined
    : NodeValue<TNode>;

export interface NodeRuntimeState<TData> {
  readonly data: TData;
  readonly status: NodeStatus;
  readonly freshness: NodeFreshness;
  readonly error: Error | null;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
}

export type RuntimeListener = () => void;

export interface GraphRuntime {
  readonly getState: <TNode extends AnyNodeDefinition>(
    node: TNode
  ) => NodeRuntimeState<RuntimeNodeData<TNode>>;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ) => void;
  readonly execute: (
    nodes: readonly AnyNodeDefinition[]
  ) => Promise<void>;
  readonly subscribeNodes: (
    nodes: readonly AnyNodeDefinition[]
  ) => NodeSubscription;
  readonly getSubscriptionState: (
    node: AnyNodeDefinition
  ) => NodeSubscriptionState;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  readonly getSchedulerState: () => SchedulerState;
  readonly whenSettled: () => Promise<void>;
  readonly onChange: (listener: RuntimeListener) => () => void;
}

interface MutableNodeRuntimeState {
  data: unknown;
  status: NodeStatus;
  freshness: NodeFreshness;
  error: Error | null;
  generation: number;
  hasSuccessfulValue: boolean;
}

interface MutableNodeSubscriptionState {
  direct: number;
  required: number;
}

type ExecutionOrigin = "explicit" | "scheduler";

interface ActiveAttempt {
  readonly generation: number;
  readonly token: symbol;
  readonly controller: AbortController;
  readonly origins: Set<ExecutionOrigin>;
  readonly promise: Promise<void>;
}

class NodeAttemptFailure extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly causeError: Error
  ) {
    super(`Node "${nodeKey}" failed.`);
    this.name = "NodeAttemptFailure";
  }
}

class NodeBlockedFailure extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly blockedBy: readonly string[]
  ) {
    super(`Node "${nodeKey}" was blocked by: ${blockedBy.join(", ")}.`);
    this.name = "NodeBlockedFailure";
  }
}

class ObsoleteAttempt extends Error {
  public constructor() {
    super("Execution attempt was aborted or superseded.");
    this.name = "ObsoleteAttempt";
  }
}

const isContextNode = (
  node: AnyNodeDefinition
): node is ContextNodeDefinition<unknown> => node.kind === "context";

const isDataNode = (
  node: AnyNodeDefinition
): node is DataNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "data";

const isDerivedNode = (
  node: AnyNodeDefinition
): node is DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "derived";

const createInitialState = (
  node: AnyNodeDefinition
): MutableNodeRuntimeState => {
  if (isContextNode(node)) {
    return {
      data: node.initialValue,
      status: "success",
      freshness: "fresh",
      error: null,
      generation: 0,
      hasSuccessfulValue: true,
    };
  }

  return {
    data: isDataNode(node) ? node.initialValue : undefined,
    status: "idle",
    freshness: "stale",
    error: null,
    generation: 0,
    hasSuccessfulValue: false,
  };
};

const snapshotState = <TData>(
  state: MutableNodeRuntimeState
): NodeRuntimeState<TData> =>
  Object.freeze({
    data: state.data as TData,
    status: state.status,
    freshness: state.freshness,
    error: state.error,
    generation: state.generation,
    hasSuccessfulValue: state.hasSuccessfulValue,
  });

export const createGraphRuntime = (graph: Graph): GraphRuntime => {
  const states = new Map<string, MutableNodeRuntimeState>();
  const subscriptionStates = new Map<string, MutableNodeSubscriptionState>();
  const activeAttempts = new Map<string, ActiveAttempt>();
  const listeners = new Set<RuntimeListener>();
  const settlementWaiters = new Set<() => void>();
  let schedulerScheduled = false;
  let schedulerRunning = false;
  let schedulerFollowUpRequired = false;
  let schedulerError: Error | null = null;

  for (const node of graph.getNodes()) {
    states.set(node.key, createInitialState(node));
    subscriptionStates.set(node.key, { direct: 0, required: 0 });
  }

  const requireState = (key: string): MutableNodeRuntimeState => {
    const state = states.get(key);
    if (!state) throw new Error(`Runtime state for node "${key}" was not found.`);
    return state;
  };

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Listener failures are isolated from runtime state and other listeners.
      }
    }
  };

  const isSchedulerSettled = (): boolean =>
    !schedulerScheduled && !schedulerRunning && !schedulerFollowUpRequired;

  const resolveSettlementWaiters = (): void => {
    if (!isSchedulerSettled()) return;
    for (const resolve of [...settlementWaiters]) resolve();
    settlementWaiters.clear();
  };

  const getSchedulerState = (): SchedulerState =>
    Object.freeze({
      isScheduled: schedulerScheduled,
      isRunning: schedulerRunning,
      error: schedulerError,
    });

  let flushScheduler: () => Promise<void>;

  const schedule = (): void => {
    if (schedulerRunning) {
      schedulerFollowUpRequired = true;
      return;
    }
    if (schedulerScheduled) return;

    schedulerScheduled = true;
    notify();
    queueMicrotask(() => {
      void flushScheduler();
    });
  };

  const requireRegisteredNode = (
    node: AnyNodeDefinition,
    purpose: string
  ): AnyNodeDefinition => {
    const registered = graph.getNode(node.key);
    if (!registered) {
      throw new Error(`Node "${node.key}" is not registered for ${purpose}.`);
    }
    return registered;
  };

  const requireSubscriptionState = (key: string): MutableNodeSubscriptionState => {
    const subscriptionState = subscriptionStates.get(key);
    if (!subscriptionState) {
      throw new Error(`Subscription state for node "${key}" was not found.`);
    }
    return subscriptionState;
  };

  const getSubscriptionState = (node: AnyNodeDefinition): NodeSubscriptionState => {
    const registered = requireRegisteredNode(node, "subscription inspection");
    const subscriptionState = requireSubscriptionState(registered.key);
    return Object.freeze({
      direct: subscriptionState.direct,
      required: subscriptionState.required,
      total: subscriptionState.direct + subscriptionState.required,
    });
  };

  const subscribeNodes = (
    requestedNodes: readonly AnyNodeDefinition[]
  ): NodeSubscription => {
    const directNodes: AnyNodeDefinition[] = [];
    const directKeys = new Set<string>();

    for (const requested of requestedNodes) {
      const registered = requireRegisteredNode(requested, "node subscription");
      if (directKeys.has(registered.key)) continue;
      directKeys.add(registered.key);
      directNodes.push(registered);
    }

    const frozenNodes = Object.freeze([...directNodes]);
    if (directNodes.length === 0) {
      return Object.freeze({
        nodes: frozenNodes,
        unsubscribe: () => undefined,
      });
    }

    const visitedAncestors = new Set<string>();
    const requiredKeys = new Set<string>();
    const queue = directNodes.flatMap(node => graph.getParents(node));

    while (queue.length > 0) {
      const ancestor = queue.shift();
      if (!ancestor || visitedAncestors.has(ancestor.key)) continue;
      visitedAncestors.add(ancestor.key);

      if (!directKeys.has(ancestor.key)) requiredKeys.add(ancestor.key);
      queue.push(...graph.getParents(ancestor));
    }

    for (const key of directKeys) requireSubscriptionState(key).direct += 1;
    for (const key of requiredKeys) requireSubscriptionState(key).required += 1;
    notify();
    schedule();

    let active = true;
    return Object.freeze({
      nodes: frozenNodes,
      unsubscribe: () => {
        if (!active) return;

        for (const key of directKeys) {
          if (requireSubscriptionState(key).direct <= 0) {
            throw new Error(`Direct subscription for node "${key}" cannot become negative.`);
          }
        }
        for (const key of requiredKeys) {
          if (requireSubscriptionState(key).required <= 0) {
            throw new Error(`Required subscription for node "${key}" cannot become negative.`);
          }
        }

        for (const key of directKeys) requireSubscriptionState(key).direct -= 1;
        for (const key of requiredKeys) requireSubscriptionState(key).required -= 1;
        active = false;

        for (const [key, attempt] of activeAttempts) {
          const subscriptionState = requireSubscriptionState(key);
          if (
            subscriptionState.direct + subscriptionState.required === 0 &&
            attempt.origins.has("scheduler") &&
            !attempt.origins.has("explicit")
          ) {
            attempt.controller.abort();
          }
        }

        notify();
        resolveSettlementWaiters();
      },
    });
  };

  const setContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ): void => {
    const registered = graph.getNode(node.key);
    if (!registered || registered.kind !== "context") {
      throw new Error(`Context node "${node.key}" is not registered in this graph.`);
    }

    const contextState = requireState(node.key);
    if (Object.is(contextState.data, value)) return;

    contextState.data = value;
    contextState.status = "success";
    contextState.freshness = "fresh";
    contextState.error = null;
    contextState.generation += 1;
    contextState.hasSuccessfulValue = true;

    const visited = new Set<string>();
    const queue = [...graph.getChildren(node)];
    let subscribedDescendantChanged = false;
    while (queue.length > 0) {
      const descendant = queue.shift();
      if (!descendant || visited.has(descendant.key)) continue;
      visited.add(descendant.key);

      const state = requireState(descendant.key);
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      state.error = null;

      activeAttempts.get(descendant.key)?.controller.abort();
      if (getSubscriptionState(descendant).total > 0) {
        subscribedDescendantChanged = true;
      }
      queue.push(...graph.getChildren(descendant));
    }

    notify();
    if (subscribedDescendantChanged) schedule();
  };

  const getDependencyValue = <TNode extends AnyNodeDefinition>(
    dependency: TNode
  ): NodeValue<TNode> => {
    const state = requireState(dependency.key);
    if (!state.hasSuccessfulValue || state.freshness !== "fresh") {
      throw new Error(
        `Dependency "${dependency.key}" does not have a successful fresh value.`
      );
    }
    return state.data as NodeValue<TNode>;
  };

  const executeNode = (
    node: AnyNodeDefinition,
    origin: ExecutionOrigin
  ): Promise<void> => {
    const state = requireState(node.key);
    if (
      state.hasSuccessfulValue &&
      state.status === "success" &&
      state.freshness === "fresh"
    ) {
      return Promise.resolve();
    }

    const active = activeAttempts.get(node.key);
    if (active?.generation === state.generation) {
      active.origins.add(origin);
      return active.promise;
    }

    if (isContextNode(node)) return Promise.resolve();

    const generation = state.generation;
    const token = Symbol(node.key);
    const controller = new AbortController();

    state.status = state.hasSuccessfulValue ? "refreshing" : "loading";
    state.freshness = "stale";
    state.error = null;
    notify();

    const run = async (): Promise<void> => {
      try {
        let value: unknown;
        if (isDataNode(node)) {
          value = await node.load({
            get: getDependencyValue,
            signal: controller.signal,
          });
        } else if (isDerivedNode(node)) {
          value = node.derive({ get: getDependencyValue });
        } else {
          return;
        }

        const current = states.get(node.key);
        const currentAttempt = activeAttempts.get(node.key);
        if (
          !current ||
          current.generation !== generation ||
          currentAttempt?.token !== token ||
          controller.signal.aborted
        ) {
          throw new ObsoleteAttempt();
        }

        current.data = value;
        current.status = "success";
        current.freshness = "fresh";
        current.error = null;
        current.hasSuccessfulValue = true;
        notify();
      } catch (thrown) {
        const current = states.get(node.key);
        const currentAttempt = activeAttempts.get(node.key);
        const obsolete =
          !current ||
          current.generation !== generation ||
          currentAttempt?.token !== token ||
          controller.signal.aborted ||
          thrown instanceof ObsoleteAttempt ||
          isAbortError(thrown);

        if (obsolete) throw new ObsoleteAttempt();

        const error = toError(thrown);
        current.status = "error";
        current.freshness = "stale";
        current.error = error;
        notify();
        throw new NodeAttemptFailure(node.key, error);
      } finally {
        if (activeAttempts.get(node.key)?.token === token) {
          activeAttempts.delete(node.key);
        }
      }
    };

    const promise = Promise.resolve().then(run);
    activeAttempts.set(node.key, {
      generation,
      token,
      controller,
      origins: new Set([origin]),
      promise,
    });
    return promise;
  };

  const executeInternal = async (
    targets: readonly AnyNodeDefinition[],
    origin: ExecutionOrigin
  ): Promise<void> => {
    if (targets.length === 0) return;

    const failures = new Map<string, NodeExecutionFailure>();
    const requested = new Map<string, Promise<void>>();

    const recordFailure = (failure: NodeExecutionFailure): void => {
      if (!failures.has(failure.nodeKey)) failures.set(failure.nodeKey, failure);
    };

    const ensureNode = (node: AnyNodeDefinition): Promise<void> => {
      const existing = requested.get(node.key);
      if (existing) return existing;

      const promise = (async (): Promise<void> => {
        const parentResults = await Promise.allSettled(
          graph.getParents(node).map(parent => ensureNode(parent))
        );
        if (
          parentResults.some(
            result =>
              result.status === "rejected" &&
              result.reason instanceof ObsoleteAttempt
          )
        ) {
          throw new ObsoleteAttempt();
        }

        const parents = graph.getParents(node);
        const blockedBy = parentResults.flatMap((result, index) =>
          result.status === "rejected"
            ? [parents[index]?.key].filter(
                (key): key is string => key !== undefined
              )
            : []
        );

        if (blockedBy.length > 0) {
          const failure: NodeExecutionFailure = {
            nodeKey: node.key,
            kind: "blocked",
            blockedBy,
          };
          recordFailure(failure);
          throw new NodeBlockedFailure(node.key, blockedBy);
        }

        try {
          await executeNode(node, origin);
        } catch (error) {
          if (error instanceof ObsoleteAttempt) throw error;
          if (error instanceof NodeAttemptFailure) {
            recordFailure({
              nodeKey: node.key,
              kind: "failed",
              error: error.causeError,
            });
          }
          throw error;
        }
      })();

      requested.set(node.key, promise);
      return promise;
    };

    const registeredTargets = targets.map(target => {
      const registered = graph.getNode(target.key);
      if (!registered) {
        throw new Error(`Execution target "${target.key}" is not registered.`);
      }
      return registered;
    });

    await Promise.allSettled(registeredTargets.map(target => ensureNode(target)));

    if (failures.size > 0) {
      throw new GraphExecutionError([...failures.values()]);
    }
  };

  const execute = (targets: readonly AnyNodeDefinition[]): Promise<void> =>
    executeInternal(targets, "explicit");

  const getSubscribedTargetsNeedingWork = (): readonly AnyNodeDefinition[] =>
    graph.getNodes().filter(node => {
      if (node.kind === "context") return false;
      if (requireSubscriptionState(node.key).direct === 0) return false;
      const state = requireState(node.key);
      return !(
        state.hasSuccessfulValue &&
        state.status === "success" &&
        state.freshness === "fresh"
      );
    });

  flushScheduler = async (): Promise<void> => {
    if (!schedulerScheduled || schedulerRunning) return;

    schedulerScheduled = false;
    schedulerRunning = true;
    schedulerFollowUpRequired = false;
    schedulerError = null;
    notify();

    try {
      const targets = getSubscribedTargetsNeedingWork();
      if (targets.length > 0) {
        await executeInternal(targets, "scheduler");
      }
    } catch (error) {
      schedulerError = toError(error);
    } finally {
      schedulerRunning = false;
      notify();

      if (schedulerFollowUpRequired) {
        schedulerFollowUpRequired = false;
        schedule();
      } else {
        resolveSettlementWaiters();
      }
    }
  };

  const whenSettled = (): Promise<void> => {
    if (isSchedulerSettled()) return Promise.resolve();
    return new Promise(resolve => settlementWaiters.add(resolve));
  };

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) =>
      snapshotState<RuntimeNodeData<TNode>>(requireState(node.key)),
    setContext,
    execute,
    subscribeNodes,
    getSubscriptionState,
    hasSubscribers: (node: AnyNodeDefinition) => getSubscriptionState(node).total > 0,
    getSchedulerState,
    whenSettled,
    onChange: (listener: RuntimeListener) => {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
  });
};
