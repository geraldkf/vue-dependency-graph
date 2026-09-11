import type {
  NodeSubscription,
  NodeSubscriptionState,
} from "./subscription";
import type { SchedulerState } from "./scheduler";
import {
  createRuntimeSchedulerController,
  type RuntimeSchedulerController,
} from "./runtime-scheduler";
import { createRuntimeObserver } from "./runtime-observer";
import {
  createRuntimeStateStore,
  type ActiveAttempt,
  type ExecutionOrigin,
  type MutableNodeRuntimeState,
} from "./runtime-state";
import type { RefreshableNodeDefinition } from "./operations";
import { createRuntimeExecutionController } from "./runtime-execution";
import {
  createRuntimeSubscriptionController,
  type RuntimeSubscriptionController,
} from "./runtime-subscriptions";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
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
  const { notify, onChange } = createRuntimeObserver();
  const refreshOperations = new Map<string, Promise<void>>();
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

  let subscriptions!: RuntimeSubscriptionController;
  let execution!: ReturnType<typeof createRuntimeExecutionController>;
  let scheduler!: RuntimeSchedulerController;

  const requireRegisteredContextNode = <TValue>(
    node: ContextNodeDefinition<TValue>
  ): ContextNodeDefinition<TValue> => {
    const registered = requireRegisteredNode(node, "context update");
    if (!isContextNode(registered)) {
      throw new Error(`Context node "${node.key}" is not registered in this graph.`);
    }
    return registered as ContextNodeDefinition<TValue>;
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

      if (subscriptions.hasSubscribers(descendant)) {
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
    if (subscribedDescendantChanged) scheduler.schedule();
  };

  execution = createRuntimeExecutionController({
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
      if (subscribedDescendantChanged) scheduler.schedule();
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
      if (!subscriptions.hasDirectSubscribers(node)) return false;
      return execution.needsExecution(node);
    });



  scheduler = createRuntimeSchedulerController({
    getTargetsNeedingWork: getSubscribedTargetsNeedingWork,
    execute: targets => execution.execute(targets, "scheduler"),
    notify,
  });

  subscriptions = createRuntimeSubscriptionController({
    graph,
    resolveRegisteredNode: requireRegisteredNode,
    notify,
    afterSubscribe: scheduler.schedule,
    afterUnsubscribe: () => {
      for (const [key, attempt] of getActiveAttempts()) {
        const node = graph.getNode(key);
        if (
          node &&
          !subscriptions.hasSubscribers(node) &&
          isSchedulerOnlyAttempt(attempt)
        ) {
          attempt.controller.abort();
        }
      }
      scheduler.resolveSettlementIfIdle();
    },
  });

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) =>
      getSnapshot(node),
    setContext,
    execute,
    prefetch,
    refresh,
    subscribeNodes: subscriptions.subscribeNodes,
    getSubscriptionState: subscriptions.getSubscriptionState,
    hasSubscribers: subscriptions.hasSubscribers,
    getSchedulerState: scheduler.getSchedulerState,
    whenSettled: scheduler.whenSettled,
    onChange,
  });
};
