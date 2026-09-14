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
import { createRuntimeTransactionCoordinator } from "./transactions/transaction-coordinator";
import type {
  ContextChange,
  EventPublication,
  GraphTransaction,
} from "./transactions/types";
import { createRuntimeStateStore, type ActiveAttempt } from "./state/state";
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
} from "./graph/types";
import type { AnyEventDefinition, EventPayload } from "./events/types";
import { createRuntimeEventMatcher } from "./events/event-matcher";
import type { AnyQueryDefinition } from "./queries/types";
import { getQueryNodes, getQueryRefreshableNodes } from "./queries/query";
import { createDefaultRefreshPolicyEnvironment } from "./refresh-policies/environment";
import { createRuntimeRefreshPolicyController } from "./refresh-policies/policy-controller";
import type { RefreshPolicyEnvironment } from "./refresh-policies/types";

export interface GraphRuntimeOptions {
  /**
   * Maximum number of data-node load functions that may run concurrently
   * within this runtime. Defaults to unlimited concurrency.
   */
  readonly maxConcurrentLoads?: number;
  /**
   * Clock and timer services used by runtime refresh policies. Tests may
   * inject a deterministic environment. Defaults to platform timers.
   */
  readonly refreshPolicyEnvironment?: RefreshPolicyEnvironment;
}

export interface GraphRuntime {
  readonly getState: <TNode extends AnyNodeDefinition>(
    node: TNode,
  ) => NodeRuntimeState<RuntimeNodeData<TNode>>;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue,
  ) => void;
  readonly execute: (nodes: readonly AnyNodeDefinition[]) => Promise<void>;
  readonly prefetch: (nodes: readonly AnyNodeDefinition[]) => Promise<void>;
  readonly prefetchQuery: (query: AnyQueryDefinition) => Promise<void>;
  readonly refresh: (
    nodes: readonly RefreshableNodeDefinition[],
  ) => Promise<void>;
  readonly refreshQuery: (query: AnyQueryDefinition) => Promise<void>;
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
  readonly subscribeNodes: (
    nodes: readonly AnyNodeDefinition[],
  ) => NodeSubscription;
  readonly getSubscriptionState: (
    node: AnyNodeDefinition,
  ) => NodeSubscriptionState;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  readonly getSchedulerState: () => SchedulerState;
  readonly whenSettled: () => Promise<void>;
  readonly onChange: (listener: RuntimeListener) => () => void;
  /**
   * Stages context writes until the successful root transaction commits.
   * Joined and nested calls share one transaction group. Failure discards
   * staged context values; transactions do not roll back remote work.
   */
  readonly transaction: <T>(
    work: (transaction: GraphTransaction) => T | Promise<T>,
  ) => Promise<T>;
}

const isAutomaticOnlyAttempt = (attempt: ActiveAttempt): boolean =>
  [...attempt.origins].every(
    origin => origin === "scheduler" || origin === "refresh-policy"
  );

export const createGraphRuntime = (
  graph: Graph,
  options?: GraphRuntimeOptions,
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
    purpose: string,
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
      options?.maxConcurrentLoads ?? Infinity,
    ),
    getMutableState,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    resolveRegisteredNode: (node) => requireRegisteredNode(node, "execution"),
    notify: emitNotify,
    onChangedRefreshResult: (node) =>
      invalidation.invalidateChangedResultDescendants(node),
  });

  const execute = (targets: readonly AnyNodeDefinition[]): Promise<void> =>
    execution.execute(targets, "explicit");

  const getSubscribedTargetsNeedingWork = (): readonly AnyNodeDefinition[] =>
    graph.getNodes().filter((node) => {
      if (node.kind === "context") return false;
      if (!subscriptions.hasDirectSubscribers(node)) return false;
      return execution.needsExecution(node);
    });

  const scheduler = createRuntimeSchedulerController({
    getTargetsNeedingWork: getSubscribedTargetsNeedingWork,
    execute: (targets) => execution.execute(targets, "scheduler"),
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
          isAutomaticOnlyAttempt(attempt)
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

  const events = createRuntimeEventMatcher({
    graph,
    getMutableState,
  });

  const commitGraphChanges = (
    contextChanges: readonly ContextChange[],
    eventPublications: readonly EventPublication[],
    immediate: boolean,
  ): void => {
    const eventTargets = events.matchPublications(
      eventPublications,
      contextChanges,
    );
    invalidation.commitContexts(
      contextChanges,
      eventTargets,
      immediate
        ? { notify: emitNotify, schedule: scheduler.schedule }
        : undefined,
    );
  };

  const transactions = createRuntimeTransactionCoordinator({
    runWithBufferedNotifications: buffer.runTransaction,
    resolveContextNode: invalidation.resolveContextNode,
    getContextGeneration: (node) => getMutableState(node.key).generation,
    commitImmediate: (contextChanges, eventPublications) =>
      commitGraphChanges(contextChanges, eventPublications, true),
    commitTransaction: (contextChanges, eventPublications) =>
      commitGraphChanges(contextChanges, eventPublications, false),
  });

  const operations = createRuntimeOperationsController({
    getMutableState,
    getActiveAttempt,
    resolveRegisteredNode: requireRegisteredNode,
    execute: (targets, origin) => execution.execute(targets, origin),
    notify: emitNotify,
  });

  const refreshPolicies = createRuntimeRefreshPolicyController({
    graph,
    environment:
      options?.refreshPolicyEnvironment ??
      createDefaultRefreshPolicyEnvironment(),
    getMutableState,
    hasSubscribers: subscriptions.hasSubscribers,
    refreshPolicyNode: operations.refreshPolicyNode,
    failPolicyNode: (node, generation, error) => {
      const state = getMutableState(node.key);
      if (state.generation !== generation) return;
      state.status = "error";
      state.freshness = "stale";
      state.error = error;
      emitNotify();
    },
  });
  onChange(refreshPolicies.reconcile);

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) =>
      getSnapshot(node),
    setContext: transactions.setContext,
    execute,
    prefetch: operations.prefetch,
    prefetchQuery: (query: AnyQueryDefinition) =>
      operations.prefetch(getQueryNodes(query)),
    refresh: operations.refresh,
    refreshQuery: (query: AnyQueryDefinition) =>
      operations.refresh(getQueryRefreshableNodes(query)),
    publish: transactions.publish,
    subscribeNodes: subscriptions.subscribeNodes,
    getSubscriptionState: subscriptions.getSubscriptionState,
    hasSubscribers: subscriptions.hasSubscribers,
    getSchedulerState: scheduler.getSchedulerState,
    whenSettled: scheduler.whenSettled,
    onChange,
    transaction: transactions.runTransaction,
  });
};
