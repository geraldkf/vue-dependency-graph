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
import { createRuntimeMutationController } from "./mutations/mutation-controller";
import {
  GraphMutationOutcomeUnknownError,
  GraphMutationReconciliationError,
  GraphMutationRollbackConflictError,
} from "./mutations/errors";
import { GraphTransactionConflictError } from "./transactions/errors";
import type { MutationDefinition, MutationOptions } from "./mutations/types";
import { createRuntimeDiagnosticEmitter } from "./diagnostics/diagnostic-emitter";
import type { GraphDiagnosticsOptions } from "./diagnostics/types";

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
  /**
   * Optional structured runtime diagnostics. Diagnostics are observational,
   * synchronous, failure-isolated, and disabled when omitted.
   */
  readonly diagnostics?: GraphDiagnosticsOptions;
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
  readonly mutate: <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    options?: MutationOptions<TInput, TResult>,
  ) => Promise<TResult>;
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
  const diagnostics = createRuntimeDiagnosticEmitter(options?.diagnostics);
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
  let pendingSchedulerReason: import("./diagnostics/types").GraphExecutionReason =
    "subscription";
  let pendingSchedulerCauseId: string | undefined;
  let schedulerOperationId = "";
  let graphChangeOperationId = "";
  let graphChangeReason: "context-invalidation" | "changed-result" =
    "context-invalidation";
  let observeGraphChange = false;

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
    onChangedRefreshResult: (node, diagnosticContext) => {
      graphChangeOperationId = diagnosticContext?.operationId ?? "";
      graphChangeReason = "changed-result";
      pendingSchedulerReason = "changed-result";
      pendingSchedulerCauseId = diagnosticContext?.operationId;
      observeGraphChange = true;
      try {
        invalidation.invalidateChangedResultDescendants(node);
      } finally {
        observeGraphChange = false;
      }
    },
    diagnostics,
  });

  const execute = (targets: readonly AnyNodeDefinition[]): Promise<void> => {
    const operationId = diagnostics.emitOperationRequested({
      type: "operation.execute.requested",
      operation: "execute",
      nodeKeys: targets.map((node) => node.key),
    });
    return execution.execute(targets, "explicit", {
      operationId,
      reason: "explicit",
    });
  };

  const getSubscribedTargetsNeedingWork = (): readonly AnyNodeDefinition[] =>
    graph.getNodes().filter((node) => {
      if (node.kind === "context") return false;
      if (!subscriptions.hasDirectSubscribers(node)) return false;
      return execution.needsExecution(node);
    });

  const scheduler = createRuntimeSchedulerController({
    getTargetsNeedingWork: getSubscribedTargetsNeedingWork,
    execute: (targets) => execution.execute(targets, "scheduler", {
      operationId: schedulerOperationId,
      ...(pendingSchedulerCauseId === undefined
        ? {}
        : { causeId: pendingSchedulerCauseId }),
      reason: pendingSchedulerReason,
    }),
    notify: emitNotify,
    onRequested: () => {
      schedulerOperationId = diagnostics.createOperationId();
      diagnostics.emit({
        type: "scheduler.requested",
        operationId: schedulerOperationId,
        ...(pendingSchedulerCauseId === undefined
          ? {}
          : { causeId: pendingSchedulerCauseId }),
        reason: pendingSchedulerReason,
        nodeKeys: [],
      });
    },
    onStarted: (targets) => {
      diagnostics.emit({
        type: "scheduler.started",
        operationId: schedulerOperationId,
        ...(pendingSchedulerCauseId === undefined
          ? {}
          : { causeId: pendingSchedulerCauseId }),
        reason: pendingSchedulerReason,
        nodeKeys: targets.map((node) => node.key),
      });
    },
    onCompleted: (error) => {
      diagnostics.emit({
        type: error ? "scheduler.failed" : "scheduler.completed",
        operationId: schedulerOperationId,
        ...(pendingSchedulerCauseId === undefined
          ? {}
          : { causeId: pendingSchedulerCauseId }),
        reason: pendingSchedulerReason,
        nodeKeys: [],
        ...(error ? { error: diagnostics.toError(error) } : {}),
      });
      pendingSchedulerReason = "subscription";
      pendingSchedulerCauseId = undefined;
    },
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
    onAdded: (nodeKeys, requiredNodeKeys) => {
      const operationId = diagnostics.createOperationId();
      diagnostics.emit({
        type: "subscription.added",
        operationId,
        nodeKeys,
        requiredNodeKeys,
      });
      pendingSchedulerReason = "subscription";
      pendingSchedulerCauseId = operationId;
    },
    onRemoved: (nodeKeys, requiredNodeKeys) => {
      diagnostics.emit({
        type: "subscription.removed",
        operationId: diagnostics.createOperationId(),
        nodeKeys,
        requiredNodeKeys,
      });
    },
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
    onContextsCommitted: (contextKeys, affectedNodeKeys, scheduled) => {
      if (!observeGraphChange || !graphChangeOperationId || contextKeys.length === 0) return;
      diagnostics.emit({
        type: "context.changed",
        operationId: graphChangeOperationId,
        contextKeys,
        affectedNodeKeys,
      });
      diagnostics.emit({
        type: "node.invalidated",
        operationId: graphChangeOperationId,
        reason: "context-invalidation",
        rootNodeKeys: contextKeys,
        affectedNodeKeys,
        scheduled,
      });
    },
    onChangedResultInvalidated: (rootNodeKeys, affectedNodeKeys, scheduled) => {
      if (!observeGraphChange || !graphChangeOperationId) return;
      diagnostics.emit({
        type: "node.invalidated",
        operationId: graphChangeOperationId,
        reason: graphChangeReason,
        rootNodeKeys,
        affectedNodeKeys,
        scheduled,
      });
    },
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
    const eventTargets = events.matchPublications(eventPublications, {
      valueOverlay: contextChanges,
    });
    const operationId = graphChangeOperationId || diagnostics.createOperationId();
    for (const publication of eventPublications) {
      diagnostics.emit({
        type: "event.published",
        operationId,
        eventKey: publication.event.key,
        transactionOwned: !immediate,
      });
    }
    if (eventPublications.length > 0) {
      diagnostics.emit({
        type: "event.matched",
        operationId,
        eventKey: eventPublications.map(({ event }) => event.key).join(","),
        transactionOwned: !immediate,
        matchedNodeKeys: eventTargets.map((node) => node.key),
      });
    }
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
    execute: (targets, origin, diagnosticContext) =>
      execution.execute(targets, origin, diagnosticContext),
    notify: emitNotify,
  });

  const mutations = createRuntimeMutationController({
    resolveRegisteredNode: requireRegisteredNode,
    getMutableState,
    getActiveAttempt,
    hasSubscribers: subscriptions.hasSubscribers,
    matchPublications: events.matchPublications,
    prepareCombinedInvalidation:
      invalidation.prepareCombinedInvalidation,
    notify: emitNotify,
    schedule: scheduler.schedule,
  });

  const refreshPolicies = createRuntimeRefreshPolicyController({
    graph,
    environment:
      options?.refreshPolicyEnvironment ??
      createDefaultRefreshPolicyEnvironment(),
    getMutableState,
    hasSubscribers: subscriptions.hasSubscribers,
    refreshPolicyNode: (node) => {
      const operationId = diagnostics.createOperationId();
      return operations.refreshPolicyNode(node, {
        operationId,
        reason: "refresh-policy",
      });
    },
    failPolicyNode: (node, generation, error) => {
      const state = getMutableState(node.key);
      if (state.generation !== generation) return;
      state.status = "error";
      state.freshness = "stale";
      state.error = error;
      emitNotify();
    },
    onDiagnostic: (type, node, details) => {
      const operationId = diagnostics.createOperationId();
      const eventType = `refresh-policy.${type}` as
        | "refresh-policy.scheduled"
        | "refresh-policy.started"
        | "refresh-policy.retry-scheduled"
        | "refresh-policy.completed"
        | "refresh-policy.failed"
        | "refresh-policy.paused"
        | "refresh-policy.resumed"
        | "refresh-policy.stopped";
      diagnostics.emit({
        type: eventType,
        operationId,
        ...(node === undefined
          ? {}
          : {
              nodeKey: node.key,
              ...(node.refresh === undefined
                ? {}
                : { policyKind: node.refresh.kind }),
            }),
        ...(details?.delayMs === undefined
          ? {}
          : { delayMs: details.delayMs }),
        ...(details?.error === undefined
          ? {}
          : { error: diagnostics.toError(details.error) }),
      });
    },
  });
  onChange(refreshPolicies.reconcile);
  diagnostics.emitRuntimeCreated(graph.getNodes().map((node) => node.key));

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) =>
      getSnapshot(node),
    setContext: <TValue>(node: ContextNodeDefinition<TValue>, value: TValue) => {
      const operationId = diagnostics.createOperationId();
      graphChangeOperationId = operationId;
      graphChangeReason = "context-invalidation";
      pendingSchedulerReason = "context-invalidation";
      pendingSchedulerCauseId = operationId;
      observeGraphChange = true;
      try {
        transactions.setContext(node, value);
      } finally {
        observeGraphChange = false;
      }
    },
    execute,
    prefetch: (nodes: readonly AnyNodeDefinition[]) => {
      const operationId = diagnostics.emitOperationRequested({
        type: "operation.prefetch.requested",
        operation: "prefetch",
        nodeKeys: nodes.map((node) => node.key),
      });
      return operations.prefetch(nodes, { operationId, reason: "prefetch" });
    },
    prefetchQuery: (query: AnyQueryDefinition) => {
      const nodes = getQueryNodes(query);
      const operationId = diagnostics.emitOperationRequested({
        type: "operation.query-prefetch.requested",
        operation: "query-prefetch",
        nodeKeys: nodes.map((node) => node.key),
        queryKey: query.key,
      });
      return operations.prefetch(nodes, {
        operationId,
        reason: "query-prefetch",
      });
    },
    refresh: (nodes: readonly RefreshableNodeDefinition[]) => {
      const operationId = diagnostics.emitOperationRequested({
        type: "operation.refresh.requested",
        operation: "refresh",
        nodeKeys: nodes.map((node) => node.key),
      });
      return operations.refresh(nodes, { operationId, reason: "refresh" });
    },
    refreshQuery: (query: AnyQueryDefinition) => {
      const nodes = getQueryRefreshableNodes(query);
      const operationId = diagnostics.emitOperationRequested({
        type: "operation.query-refresh.requested",
        operation: "query-refresh",
        nodeKeys: nodes.map((node) => node.key),
        queryKey: query.key,
      });
      return operations.refresh(nodes, {
        operationId,
        reason: "query-refresh",
      });
    },
    publish: <TEvent extends AnyEventDefinition>(
      event: TEvent,
      payload: EventPayload<TEvent>,
    ) => {
      graphChangeOperationId = diagnostics.createOperationId();
      transactions.publish(event, payload);
    },
    mutate: <TInput, TResult>(
      mutation: MutationDefinition<TInput, TResult>,
      input: TInput,
      mutationOptions?: MutationOptions<TInput, TResult>,
    ) => {
      const operationId = diagnostics.createOperationId();
      const startedAt = diagnostics.now();
      diagnostics.emit({
        type: "mutation.started",
        operationId,
        mutationKey: mutation.key,
      });
      return mutations.mutate(
        mutation,
        input,
        mutationOptions,
        (type, affectedNodeKeys) => {
          diagnostics.emit({
            type: `mutation.${type}` as
              | "mutation.optimistic-committed"
              | "mutation.remote-started"
              | "mutation.remote-succeeded"
              | "mutation.remote-failed"
              | "mutation.success-committed",
            operationId,
            mutationKey: mutation.key,
            ...(affectedNodeKeys === undefined ? {} : { affectedNodeKeys }),
          });
        },
      ).then(
        result => {
          diagnostics.emit({
            type: "mutation.completed",
            operationId,
            mutationKey: mutation.key,
            outcome: "succeeded",
            durationMs: diagnostics.now() - startedAt,
          });
          return result;
        },
        error => {
          const normalised = error instanceof Error ? error : new Error(String(error));
          const type = error instanceof GraphMutationRollbackConflictError
            ? "mutation.rollback-conflicted"
            : error instanceof GraphMutationOutcomeUnknownError
              ? "mutation.outcome-unknown"
              : error instanceof GraphMutationReconciliationError
                ? "mutation.reconciliation-failed"
                : "mutation.rolled-back";
          const outcome = error instanceof GraphMutationRollbackConflictError
            ? "rollback-conflict"
            : error instanceof GraphMutationOutcomeUnknownError
              ? "unknown"
              : error instanceof GraphMutationReconciliationError
                ? "reconciliation-failed"
                : "rejected";
          diagnostics.emit({
            type,
            operationId,
            mutationKey: mutation.key,
            outcome,
            durationMs: diagnostics.now() - startedAt,
            error: diagnostics.toError(normalised),
          });
          diagnostics.emit({
            type: "mutation.completed",
            operationId,
            mutationKey: mutation.key,
            outcome,
            durationMs: diagnostics.now() - startedAt,
            error: diagnostics.toError(normalised),
          });
          throw error;
        },
      );
    },
    subscribeNodes: subscriptions.subscribeNodes,
    getSubscriptionState: subscriptions.getSubscriptionState,
    hasSubscribers: subscriptions.hasSubscribers,
    getSchedulerState: scheduler.getSchedulerState,
    whenSettled: scheduler.whenSettled,
    onChange,
    transaction: <T>(work: (transaction: GraphTransaction) => T | Promise<T>) => {
      const operationId = diagnostics.createOperationId();
      const startedAt = diagnostics.now();
      diagnostics.emit({
        type: "transaction.started",
        operationId,
      });
      graphChangeOperationId = operationId;
      return transactions.runTransaction(work).then(
        result => {
          diagnostics.emit({
            type: "transaction.committed",
            operationId,
            durationMs: diagnostics.now() - startedAt,
          });
          return result;
        },
        error => {
          const normalised = error instanceof Error ? error : new Error(String(error));
          if (error instanceof GraphTransactionConflictError) {
            diagnostics.emit({
              type: "transaction.conflicted",
              operationId,
              conflictKeys: error.contextKeys,
              durationMs: diagnostics.now() - startedAt,
              error: diagnostics.toError(normalised),
            });
          } else {
            diagnostics.emit({
              type: "transaction.rolled-back",
              operationId,
              durationMs: diagnostics.now() - startedAt,
              error: diagnostics.toError(normalised),
            });
          }
          throw error;
        },
      );
    },
  });
};
