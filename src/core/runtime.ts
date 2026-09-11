import type {
  NodeSubscription,
  NodeSubscriptionState,
} from "./subscription";
import type { SchedulerState } from "./scheduler";
import { createRuntimeObserver } from "./runtime-observer";
import {
  createRuntimeStateStore,
  type ActiveAttempt,
  type ExecutionOrigin,
  type MutableNodeRuntimeState,
} from "./runtime-state";
import type { RefreshableNodeDefinition } from "./operations";
import { toError } from "./execution";
import { createRuntimeExecutionController } from "./runtime-execution";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  Graph,
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
  readonly prefetch: (
    nodes: readonly AnyNodeDefinition[]
  ) => Promise<void>;
  readonly refresh: (
    nodes: readonly RefreshableNodeDefinition[]
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

interface MutableNodeSubscriptionState {
  direct: number;
  required: number;
}

const isSchedulerOnlyAttempt = (attempt: ActiveAttempt): boolean =>
  attempt.origins.size === 1 && attempt.origins.has("scheduler");

const createRefreshOperationKey = (keys: ReadonlySet<string>): string =>
  JSON.stringify([...keys].sort());

const isContextNode = (
  node: AnyNodeDefinition
): node is ContextNodeDefinition<unknown> => node.kind === "context";

export const createGraphRuntime = (graph: Graph): GraphRuntime => {
  const {
    getMutableState,
    getSnapshot,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    getActiveAttempts,
  } = createRuntimeStateStore(graph);
  const subscriptionStates = new Map<string, MutableNodeSubscriptionState>();
  const { notify, onChange } = createRuntimeObserver();
  const settlementWaiters = new Set<() => void>();
  const refreshOperations = new Map<string, Promise<void>>();
  let schedulerScheduled = false;
  let schedulerRunning = false;
  let schedulerFollowUpRequired = false;
  let schedulerError: Error | null = null;

  for (const node of graph.getNodes()) {
    subscriptionStates.set(node.key, { direct: 0, required: 0 });
  }

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

  const requireRegisteredContextNode = <TValue>(
    node: ContextNodeDefinition<TValue>
  ): ContextNodeDefinition<TValue> => {
    const registered = requireRegisteredNode(node, "context update");
    if (!isContextNode(registered)) {
      throw new Error(`Context node "${node.key}" is not registered in this graph.`);
    }
    return registered as ContextNodeDefinition<TValue>;
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

        for (const [key, attempt] of getActiveAttempts()) {
          const subscriptionState = requireSubscriptionState(key);
          if (
            subscriptionState.direct + subscriptionState.required === 0 &&
            isSchedulerOnlyAttempt(attempt)
          ) {
            attempt.controller.abort();
          }
        }

        notify();
        resolveSettlementWaiters();
      },
    });
  };

  const invalidateDescendants = (node: AnyNodeDefinition): boolean => {
    const visited = new Set<string>();
    const queue = [...graph.getChildren(node)];
    let subscribedDescendantChanged = false;

    while (queue.length > 0) {
      const descendant = queue.shift();
      if (!descendant || visited.has(descendant.key)) continue;
      visited.add(descendant.key);

      const state = getMutableState(descendant.key);
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      state.error = null;
      getActiveAttempt(descendant.key)?.controller.abort();

      const subscriptionState = requireSubscriptionState(descendant.key);
      if (subscriptionState.direct + subscriptionState.required > 0) {
        subscribedDescendantChanged = true;
      }
      queue.push(...graph.getChildren(descendant));
    }

    return subscribedDescendantChanged;
  };

  const setContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ): void => {
    const registered = requireRegisteredContextNode(node);

    const contextState = getMutableState(registered.key);
    if (Object.is(contextState.data, value)) return;

    contextState.data = value;
    contextState.status = "success";
    contextState.freshness = "fresh";
    contextState.error = null;
    contextState.generation += 1;
    contextState.hasSuccessfulValue = true;

    const subscribedDescendantChanged = invalidateDescendants(registered);
    notify();
    if (subscribedDescendantChanged) schedule();
  };

  const execution = createRuntimeExecutionController({
    graph,
    getMutableState,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    resolveRegisteredNode: node =>
      requireRegisteredNode(node, "execution"),
    notify,
    onChangedRefreshResult: node => {
      const subscribedDescendantChanged = invalidateDescendants(node);
      if (graph.getChildren(node).length > 0) notify();
      if (subscribedDescendantChanged) schedule();
    },
  });

  const execute = (targets: readonly AnyNodeDefinition[]): Promise<void> =>
    execution.execute(targets, "explicit");

  const prefetch = (targets: readonly AnyNodeDefinition[]): Promise<void> =>
    execution.execute(targets, "prefetch");

  const refresh = (
    requestedTargets: readonly RefreshableNodeDefinition[]
  ): Promise<void> => {
    if (requestedTargets.length === 0) return Promise.resolve();

    const targets: RefreshableNodeDefinition[] = [];
    const keys = new Set<string>();
    for (const requested of requestedTargets) {
      const registered = requireRegisteredNode(requested, "manual refresh");
      if (registered.kind === "context") {
        return Promise.reject(
          new Error(`Context node "${registered.key}" cannot be refreshed.`)
        );
      }
      if (keys.has(registered.key)) continue;
      keys.add(registered.key);
      targets.push(registered as RefreshableNodeDefinition);
    }

    const operationKey = createRefreshOperationKey(keys);
    const existing = refreshOperations.get(operationKey);
    if (existing) return existing;

    for (const target of targets) {
      const state = getMutableState(target.key);
      const active = getActiveAttempt(target.key);
      if (active?.origins.has("refresh")) continue;
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      active?.controller.abort();
    }
    notify();

    const operation = execution.execute(targets, "refresh").finally(() => {
      if (refreshOperations.get(operationKey) === operation) {
        refreshOperations.delete(operationKey);
      }
    });
    refreshOperations.set(operationKey, operation);
    return operation;
  };

  const getSubscribedTargetsNeedingWork = (): readonly AnyNodeDefinition[] =>
    graph.getNodes().filter(node => {
      if (node.kind === "context") return false;
      if (requireSubscriptionState(node.key).direct === 0) return false;
      return execution.needsExecution(node);
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
        await execution.execute(targets, "scheduler");
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
      getSnapshot(node),
    setContext,
    execute,
    prefetch,
    refresh,
    subscribeNodes,
    getSubscriptionState,
    hasSubscribers: (node: AnyNodeDefinition) => getSubscriptionState(node).total > 0,
    getSchedulerState,
    whenSettled,
    onChange,
  });
};
