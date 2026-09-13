import type {
  NodeSubscription,
  NodeSubscriptionState,
} from "./subscriptions/types";
import type { SchedulerState } from "./scheduling/types";
import {
  createRuntimeSchedulerController,
  type RuntimeSchedulerController,
} from "./scheduling/scheduler";
import { createRuntimeObserver } from "./observation/observer";
import type { RuntimeListener } from "./observation/types";
import {
  createRuntimeNotificationBuffer,
  type RuntimeNotificationBuffer,
} from "./transactions/notification-buffer";
import {
  createRuntimeStateStore,
  type ActiveAttempt,
} from "./state/state";
import type {
  NodeFreshness,
  NodeRuntimeState,
  NodeStatus,
  RuntimeNodeData,
} from "./state/types";
import type { RefreshableNodeDefinition } from "./operations/types";
import { createRuntimeOperationsController } from "./operations/operations";
import { createExecutionConcurrencyLimiter } from "./execution/concurrency-limiter";
import { createRuntimeExecutionController } from "./execution/execution";
import {
  createRuntimeInvalidationController,
  type RuntimeInvalidationController,
} from "./invalidation/invalidation";
import {
  createRuntimeSubscriptionController,
  type RuntimeSubscriptionController,
} from "./subscriptions/subscriptions";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  Graph,
} from "./graph/node";

export interface GraphRuntimeOptions {
  /**
   * Maximum number of data-node load functions that may run concurrently
   * within this runtime. Defaults to unlimited concurrency.
   */
  readonly maxConcurrentLoads?: number;
}

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
  /**
   * Runs `work`, coalescing every notify/schedule dispatch caused by it
   * into a single commit once `work` settles. Depth stays open across any
   * awaited gap inside `work`, so a `transaction` spanning multiple async
   * steps still produces one flush instead of one per step. Nested
   * transactions collapse into the outermost one's commit. State mutations
   * inside `work` are applied immediately and are not rolled back on
   * failure — this defers observation, it does not provide isolation.
   */
  readonly transaction: <T>(work: () => T | Promise<T>) => Promise<T>;
}

const isSchedulerOnlyAttempt = (attempt: ActiveAttempt): boolean =>
  attempt.origins.size === 1 && attempt.origins.has("scheduler");

export const createGraphRuntime = (
  graph: Graph,
  options?: GraphRuntimeOptions
): GraphRuntime => {
  const {
    getMutableState,
    getSnapshot,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    getActiveAttempts,
  } = createRuntimeStateStore(graph);
  const { notify: emitNotify, onChange } = createRuntimeObserver();
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

  // Only these three bindings are genuinely forward-referenced: each is
  // read inside a closure that is constructed before the binding itself
  // is assigned. `execution` and `scheduler` are never read before their
  // own assignment anywhere in this function, so they're declared with
  // `const` below instead of joining this list.
  //
  // - `subscriptions`: read inside its own `afterUnsubscribe` callback
  //   (constructed as part of its own call below) and inside
  //   `getSubscribedTargetsNeedingWork` (defined before subscriptions
  //   exists, called later by the scheduler).
  // - `invalidation`: read inside `execution`'s `onChangedRefreshResult`
  //   callback. `execution` is constructed first, before `invalidation`
  //   exists.
  // - `buffer`: read inside `execution`'s `notify` callback, same reason.
  let subscriptions!: RuntimeSubscriptionController;
  let invalidation!: RuntimeInvalidationController;
  let buffer!: RuntimeNotificationBuffer;

  const execution = createRuntimeExecutionController({
    graph,
    concurrencyLimiter: createExecutionConcurrencyLimiter(
      options?.maxConcurrentLoads ?? Infinity
    ),
    getMutableState,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    resolveRegisteredNode: node =>
      requireRegisteredNode(node, "execution"),
    notify: () => buffer.notify(),
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

  const scheduler = createRuntimeSchedulerController({
    getTargetsNeedingWork: getSubscribedTargetsNeedingWork,
    execute: targets => execution.execute(targets, "scheduler"),
    notify: emitNotify,
  });

  // The buffer's real sinks are the observer's raw notify and the
  // scheduler's own schedule/resolveSettlementIfIdle. Everything else in
  // this composition root talks to `buffer.*`, never to `emitNotify` or
  // `scheduler.schedule` directly, so a future `transaction(...)` call can
  // defer dispatch without any capability needing to know a transaction is
  // open.
  buffer = createRuntimeNotificationBuffer({
    notify: emitNotify,
    schedule: scheduler.schedule,
    resolveSettlementIfIdle: scheduler.resolveSettlementIfIdle,
    whenSettled: scheduler.whenSettled,
  });

  subscriptions = createRuntimeSubscriptionController({
    graph,
    resolveRegisteredNode: requireRegisteredNode,
    notify: buffer.notify,
    afterSubscribe: buffer.schedule,
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
      buffer.resolveSettlementIfIdle();
    },
  });

  invalidation = createRuntimeInvalidationController({
    graph,
    getMutableState,
    getActiveAttempt,
    hasSubscribers: subscriptions.hasSubscribers,
    resolveRegisteredNode: requireRegisteredNode,
    notify: buffer.notify,
    schedule: buffer.schedule,
  });

  const operations = createRuntimeOperationsController({
    getMutableState,
    getActiveAttempt,
    resolveRegisteredNode: requireRegisteredNode,
    execute: (targets, origin) => execution.execute(targets, origin),
    notify: buffer.notify,
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
    whenSettled: buffer.whenSettled,
    onChange,
    transaction: buffer.runTransaction,
  });
};
