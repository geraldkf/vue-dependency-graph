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
import { createRuntimeOperationsController } from "./runtime-operations";
import { createRuntimeExecutionController } from "./runtime-execution";
import {
  createRuntimeInvalidationController,
  type RuntimeInvalidationController,
} from "./runtime-invalidation";
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
  let invalidation!: RuntimeInvalidationController;

  execution = createRuntimeExecutionController({
    graph,
    getMutableState,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    resolveRegisteredNode: node =>
      requireRegisteredNode(node, "execution"),
    notify,
    onChangedRefreshResult: node =>
      invalidation.invalidateChangedResultDescendants(node),
  });

  const execute = (targets: readonly AnyNodeDefinition[]): Promise<void> =>
    execution.execute(targets, "explicit");

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

  invalidation = createRuntimeInvalidationController({
    graph,
    getMutableState,
    getActiveAttempt,
    hasSubscribers: subscriptions.hasSubscribers,
    resolveRegisteredNode: requireRegisteredNode,
    notify,
    schedule: scheduler.schedule,
  });

  const operations = createRuntimeOperationsController({
    getMutableState,
    getActiveAttempt,
    resolveRegisteredNode: requireRegisteredNode,
    execute: (targets, origin) => execution.execute(targets, origin),
    notify,
  });

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) =>
      getSnapshot(node),
    setContext: invalidation.setContext,
    execute,
    prefetch: operations.prefetch,
    refresh: operations.refresh,
    subscribeNodes: subscriptions.subscribeNodes,
    getSubscriptionState: subscriptions.getSubscriptionState,
    hasSubscribers: subscriptions.hasSubscribers,
    getSchedulerState: scheduler.getSchedulerState,
    whenSettled: scheduler.whenSettled,
    onChange,
  });
};
