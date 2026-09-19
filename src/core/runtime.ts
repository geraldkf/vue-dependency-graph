import type {
  NodeSubscription,
  NodeSubscriptionState,
} from "./subscriptions/types";
import type { SchedulerState } from "./scheduling/types";
import {
  createRuntimeSchedulerController,
  type RuntimeSchedulerController,
} from "./scheduling/scheduler";
import { createSchedulerRequestTracker } from "./scheduling/request-tracker";
import { createRuntimeObserver } from "./observation/observer";
import type { RuntimeListener } from "./observation/types";
import { createRuntimeTransactionCoordinator } from "./transactions/transaction-coordinator";
import type {
  ContextChange,
  EventPublication,
  GraphTransaction,
  TransactionCommitContext,
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
import { createRuntimeRefreshPolicyController } from "./refresh-policies/policy-controller";
import { createRuntimeReleasePolicyController } from "./release-policies/policy-controller";
import { createDefaultTimerEnvironment } from "./timer-environment";
import type { TimerEnvironment } from "./timer-environment";
import { createRuntimeMutationController } from "./mutations/mutation-controller";
import type { MutationDefinition, MutationOptions } from "./mutations/types";
import { createRuntimeDiagnosticEmitter } from "./diagnostics/diagnostic-emitter";
import type { GraphDiagnosticsOptions } from "./diagnostics/types";
import {
  createDiagnosticSnapshot,
  type DiagnosticCollectorInspection,
  type GraphDiagnosticSnapshotV1,
} from "./diagnostics/snapshot";
import { createOperationObservationTracker } from "./diagnostics/operation-observation";
import { beginMutationDiagnostics } from "./diagnostics/mutation-diagnostics";
import { beginTransactionDiagnostics } from "./diagnostics/transaction-diagnostics";
import { createLateBinding } from "./util/late-binding";

export interface GraphRuntimeOptions {
  /**
   * Maximum number of data-node load functions that may run concurrently
   * within this runtime. Defaults to unlimited concurrency.
   */
  readonly maxConcurrentLoads?: number;
  /**
   * Clock and timer services used by refresh policies and release
   * policies. Tests may inject a deterministic environment. Defaults to
   * platform timers.
   */
  readonly timerEnvironment?: TimerEnvironment;
  /**
   * Default idle duration, in milliseconds, before a data node's value is
   * automatically released (reset to its never-loaded shape) once it has
   * no subscribers - direct or required. A node's own `release` policy,
   * when declared, always takes precedence over this default, including
   * `retain()`, which opts a node out even when this default is set.
   * Omitted entirely, no automatic release happens for any node unless it
   * declares its own `release: releaseAfter(...)`. See
   * `docs/decisions/ADR-016-value-release-policies.md`.
   */
  readonly releaseAfterMs?: number;
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
  readonly createDiagnosticSnapshot: () => GraphDiagnosticSnapshotV1;
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

  // `subscriptions` and `invalidation` are genuinely forward-referenced:
  // each is read inside a closure that is constructed before the
  // controller itself is assigned below (`execution`'s
  // `onChangedRefreshResult`, and `subscriptions`' own `afterUnsubscribe`
  // and `getSubscribedTargetsNeedingWork`). These bindings make that
  // explicit and guard against reading them too early, instead of a bare
  // `let x!: T` non-null assertion. Everywhere else in this function reads
  // `subscriptions`/`invalidation` after they're assigned, so those sites
  // use the plain local `const` created alongside each `set()` call below.
  const subscriptionsBinding =
    createLateBinding<RuntimeSubscriptionController>("subscriptions");
  const invalidationBinding =
    createLateBinding<RuntimeInvalidationController>("invalidation");

  // Tracks *why* the next scheduler flush is happening. The scheduler's
  // `schedule()` takes no arguments and flushes on a microtask, so the
  // reason has to be recorded ahead of time by whichever trigger requested
  // the run, then read back when the flush actually executes.
  const schedulerRequest = createSchedulerRequestTracker("subscription");

  // Tracks the operation id/reason of the graph-change currently being
  // committed, so invalidation callbacks several layers down can attribute
  // their diagnostics to it without threading it through every signature
  // in between. Correctly nests (and restores) via `runObserved`.
  const operationObservation = createOperationObservationTracker();

  // Only read/written from within the four scheduler callbacks wired
  // below, so - unlike `subscriptions`/`invalidation` - it needs no
  // forward-reference guard, just a declaration ahead of that wiring.
  let schedulerOperationId = "";

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
      const operationId = diagnosticContext?.operationId ?? "";
      schedulerRequest.request("changed-result", diagnosticContext?.operationId);
      operationObservation.runObserved(
        { operationId, reason: "changed-result" },
        () => invalidationBinding.get().invalidateChangedResultDescendants(node),
      );
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
      if (!subscriptionsBinding.get().hasDirectSubscribers(node)) return false;
      return execution.needsExecution(node);
    });

  const scheduler = createRuntimeSchedulerController({
    getTargetsNeedingWork: getSubscribedTargetsNeedingWork,
    execute: (targets) => {
      const pending = schedulerRequest.peek();
      return execution.execute(targets, "scheduler", {
        operationId: schedulerOperationId,
        ...(pending.causeId === undefined ? {} : { causeId: pending.causeId }),
        reason: pending.reason,
      });
    },
    notify: emitNotify,
    onRequested: () => {
      schedulerOperationId = diagnostics.createOperationId();
      const pending = schedulerRequest.peek();
      diagnostics.emit({
        type: "scheduler.requested",
        operationId: schedulerOperationId,
        ...(pending.causeId === undefined ? {} : { causeId: pending.causeId }),
        reason: pending.reason,
        nodeKeys: [],
      });
    },
    onStarted: (targets) => {
      const pending = schedulerRequest.peek();
      diagnostics.emit({
        type: "scheduler.started",
        operationId: schedulerOperationId,
        ...(pending.causeId === undefined ? {} : { causeId: pending.causeId }),
        reason: pending.reason,
        nodeKeys: targets.map((node) => node.key),
      });
    },
    onCompleted: (error) => {
      const pending = schedulerRequest.peek();
      diagnostics.emit({
        type: error ? "scheduler.failed" : "scheduler.completed",
        operationId: schedulerOperationId,
        ...(pending.causeId === undefined ? {} : { causeId: pending.causeId }),
        reason: pending.reason,
        nodeKeys: [],
        ...(error ? { error: diagnostics.toError(error) } : {}),
      });
      schedulerRequest.reset();
    },
  });

  const subscriptions = createRuntimeSubscriptionController({
    graph,
    resolveRegisteredNode: requireRegisteredNode,
    notify: emitNotify,
    onAdded: (nodeKeys, requiredNodeKeys) => {
      const operationId = diagnostics.createOperationId();
      diagnostics.emit({
        type: "subscription.added",
        operationId,
        nodeKeys,
        requiredNodeKeys,
      });
      schedulerRequest.request("subscription", operationId);
    },
    onRemoved: (nodeKeys, requiredNodeKeys) => {
      diagnostics.emit({
        type: "subscription.removed",
        operationId: diagnostics.createOperationId(),
        nodeKeys,
        requiredNodeKeys,
      });
    },
    afterSubscribe: scheduler.schedule,
    afterUnsubscribe: () => {
      for (const [key, attempt] of getActiveAttempts()) {
        const node = graph.getNode(key);
        if (
          node &&
          !subscriptionsBinding.get().hasSubscribers(node) &&
          isAutomaticOnlyAttempt(attempt)
        ) {
          attempt.controller.abort();
        }
      }
      scheduler.resolveSettlementIfIdle();
    },
  });
  subscriptionsBinding.set(subscriptions);

  const invalidation = createRuntimeInvalidationController({
    graph,
    getMutableState,
    getActiveAttempt,
    hasSubscribers: subscriptions.hasSubscribers,
    resolveRegisteredNode: requireRegisteredNode,
    notify: emitNotify,
    schedule: scheduler.schedule,
    onContextsCommitted: (contextKeys, affectedNodeKeys, scheduled) => {
      const observation = operationObservation.current();
      if (!observation || !observation.operationId || contextKeys.length === 0) return;
      diagnostics.emit({
        type: "context.changed",
        operationId: observation.operationId,
        contextKeys,
        affectedNodeKeys,
      });
      diagnostics.emit({
        type: "node.invalidated",
        operationId: observation.operationId,
        reason: "context-invalidation",
        rootNodeKeys: contextKeys,
        affectedNodeKeys,
        scheduled,
      });
    },
    onChangedResultInvalidated: (rootNodeKeys, affectedNodeKeys, scheduled) => {
      const observation = operationObservation.current();
      if (!observation || !observation.operationId) return;
      diagnostics.emit({
        type: "node.invalidated",
        operationId: observation.operationId,
        reason: observation.reason,
        rootNodeKeys,
        affectedNodeKeys,
        scheduled,
      });
    },
  });
  invalidationBinding.set(invalidation);

  const events = createRuntimeEventMatcher({
    graph,
    getMutableState,
  });

  const commitGraphChanges = (
    contextChanges: readonly ContextChange[],
    eventPublications: readonly EventPublication[],
    immediate: boolean,
    commitContext?: TransactionCommitContext,
  ): void => {
    const operationId =
      commitContext?.operationId ||
      operationObservation.current()?.operationId ||
      diagnostics.createOperationId();
    schedulerRequest.request("context-invalidation", operationId);

    operationObservation.runObserved(
      { operationId, reason: "context-invalidation" },
      () => {
        const eventTargets = events.matchPublications(eventPublications, {
          valueOverlay: contextChanges,
        });
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
      },
    );
  };

  const transactions = createRuntimeTransactionCoordinator({
    resolveContextNode: invalidation.resolveContextNode,
    getContextGeneration: (node) => getMutableState(node.key).generation,
    commitImmediate: (contextChanges, eventPublications) =>
      commitGraphChanges(contextChanges, eventPublications, true),
    commitTransaction: (contextChanges, eventPublications, commitContext) =>
      commitGraphChanges(
        contextChanges,
        eventPublications,
        false,
        commitContext,
      ),
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

  const timerEnvironment: TimerEnvironment =
    options?.timerEnvironment ?? createDefaultTimerEnvironment();

  const refreshPolicies = createRuntimeRefreshPolicyController({
    graph,
    environment: timerEnvironment,
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

  const releasePolicies = createRuntimeReleasePolicyController({
    graph,
    environment: timerEnvironment,
    getMutableState,
    hasSubscribers: subscriptions.hasSubscribers,
    defaultDurationMs: options?.releaseAfterMs,
    notify: emitNotify,
    onDiagnostic: (nodeKey, idleMs) => {
      diagnostics.emit({
        type: "node.value-released",
        operationId: diagnostics.createOperationId(),
        nodeKey,
        idleMs,
      });
    },
  });
  onChange(releasePolicies.reconcile);
  diagnostics.emitRuntimeCreated(graph.getNodes().map((node) => node.key));

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) =>
      getSnapshot(node),
    setContext: <TValue>(node: ContextNodeDefinition<TValue>, value: TValue) => {
      const operationId = diagnostics.createOperationId();
      schedulerRequest.request("context-invalidation", operationId);
      operationObservation.runObserved(
        { operationId, reason: "context-invalidation" },
        () => transactions.setContext(node, value),
      );
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
      const operationId = diagnostics.createOperationId();
      operationObservation.runObserved(
        { operationId, reason: "context-invalidation" },
        () => transactions.publish(event, payload),
      );
    },
    mutate: <TInput, TResult>(
      mutation: MutationDefinition<TInput, TResult>,
      input: TInput,
      mutationOptions?: MutationOptions<TInput, TResult>,
    ) => {
      const session = beginMutationDiagnostics(diagnostics, mutation.key);
      return mutations
        .mutate(mutation, input, mutationOptions, session.onLifecycle)
        .then(session.reportSuccess, session.reportFailure);
    },
    subscribeNodes: subscriptions.subscribeNodes,
    getSubscriptionState: subscriptions.getSubscriptionState,
    hasSubscribers: subscriptions.hasSubscribers,
    getSchedulerState: scheduler.getSchedulerState,
    whenSettled: scheduler.whenSettled,
    onChange,
    createDiagnosticSnapshot: () => createDiagnosticSnapshot({
      graph,
      runtimeId: diagnostics.runtimeId,
      now: diagnostics.now,
      getMutableState,
      getSchedulerState: scheduler.getSchedulerState,
      getSubscriptionState: subscriptions.getSubscriptionState,
      getRefreshPolicySnapshot: refreshPolicies.getDiagnosticSnapshot,
      ...(options?.diagnostics?.sink === undefined
        ? {}
        : {
            collector: options.diagnostics.sink as DiagnosticCollectorInspection,
          }),
    }),
    transaction: <T>(work: (transaction: GraphTransaction) => T | Promise<T>) => {
      const session = beginTransactionDiagnostics(diagnostics);
      return transactions
        .runTransaction(work, { operationId: session.operationId })
        .then(session.reportCommitted, session.reportFailed);
    },
  });
};
