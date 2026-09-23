import { createGraphCommitCoordinator } from "./composition/graph-commit";
import { createGraphCoordination } from "./composition/graph-coordination";
import { createRuntimePolicyServices } from "./composition/policy-services";
import {
  createRuntimeDiagnosticEmitter,
  type RuntimeDiagnosticEmitter,
} from "./diagnostics/diagnostic-emitter";
import { beginMutationDiagnostics } from "./diagnostics/mutation-diagnostics";
import { createOperationObservationTracker } from "./diagnostics/operation-observation";
import {
  createDiagnosticSnapshot,
  type DiagnosticCollectorInspection,
} from "./diagnostics/snapshot";
import { beginTransactionDiagnostics } from "./diagnostics/transaction-diagnostics";
import type { GraphExecutionReason } from "./diagnostics/types";
import { createRuntimeEventMatcher } from "./events/event-matcher";
import type { AnyEventDefinition, EventPayload } from "./events/types";
import type { ExecutionDiagnosticContext } from "./execution/execution";
import { toError } from "./execution/types";
import type { AnyNodeDefinition, ContextNodeDefinition, Graph } from "./graph/types";
import { createRuntimeMutationController } from "./mutations/mutation-controller";
import type { MutationDefinition, MutationOptions } from "./mutations/types";
import { createRuntimeObserver } from "./observation/observer";
import { createRuntimeOperationsController } from "./operations/operations";
import type { RefreshableNodeDefinition } from "./operations/types";
import { getQueryNodes, getQueryRefreshableNodes } from "./queries/query";
import type { AnyQueryDefinition } from "./queries/types";
import { createSchedulerRequestTracker } from "./scheduling/request-tracker";
import { createRuntimeStateStore } from "./state/state";
import { createRuntimeTransactionCoordinator } from "./transactions/transaction-coordinator";
import type { GraphTransaction } from "./transactions/types";
import type { GraphRuntime, GraphRuntimeOptions } from "./runtime-types";

// The public runtime contract lives in `runtime-types.ts`; re-exported here so
// existing imports of these types from "./runtime" keep working.
export type { GraphRuntime, GraphRuntimeOptions } from "./runtime-types";

type RequestedOperation = Parameters<
  RuntimeDiagnosticEmitter["emitOperationRequested"]
>[0]["operation"];

/**
 * Creates a {@link GraphRuntime} from a validated {@link Graph} - the
 * object that actually loads data, tracks state, runs mutations, and
 * notifies subscribers. A graph is a static description; a runtime is the
 * live instance of it, typically created once per application (or once per
 * test).
 *
 * Call {@link GraphRuntime.dispose} when the runtime is no longer needed
 * (e.g. in a test's teardown) to stop its background refresh/release
 * timers.
 *
 * @example
 * ```ts
 * import { createGraph, createGraphRuntime, defineContextNode, defineDataNode } from "vue-dependency-graph/core";
 *
 * interface Product {
 *   readonly id: string;
 *   readonly name: string;
 * }
 *
 * const currentProductId = defineContextNode({
 *   key: "currentProductId",
 *   initialValue: "prod-1",
 * });
 *
 * const product = defineDataNode({
 *   key: "product",
 *   dependencies: [currentProductId],
 *   initialValue: null as Product | null,
 *   load: async ({ get }) => fetch(`/api/products/${get(currentProductId)}`).then((r) => r.json()),
 * });
 *
 * const runtime = createGraphRuntime(createGraph({ nodes: [currentProductId, product] }));
 *
 * await runtime.execute([product]);
 * console.log(runtime.getState(product).data);
 * ```
 *
 * @see {@link createGraphRuntimePlugin} for wiring a runtime into a Vue app.
 */
export const createGraphRuntime = (graph: Graph, options?: GraphRuntimeOptions): GraphRuntime => {
  const diagnostics = createRuntimeDiagnosticEmitter(options?.diagnostics);
  const {
    getNodeState,
    getSnapshot,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    getActiveAttempts,
  } = createRuntimeStateStore(graph);
  // Tracks the operation id/reason of the graph-change currently being
  // committed, so invalidation callbacks several layers down can attribute
  // their diagnostics to it without threading it through every signature
  // in between. Correctly nests (and restores) via `runObserved`.
  const operationObservation = createOperationObservationTracker();
  const { notify: emitNotify, onChange } = createRuntimeObserver({
    // A throwing listener (an app's `onChange`, or one of the runtime's own
    // policies, which listen the same way) is isolated from the rest; this
    // keeps it visible. Attributed to the operation being committed, if any.
    onListenerError: (error) => {
      const operationId = operationObservation.current()?.operationId;
      diagnostics.emit({
        type: "runtime.listener-failed",
        ...(operationId ? { operationId } : {}),
        error: diagnostics.toError(toError(error)),
      });
    },
  });
  const requireRegisteredNode = (node: AnyNodeDefinition, purpose: string): AnyNodeDefinition => {
    const registered = graph.getNode(node.key);
    if (!registered) {
      throw new Error(`Node "${node.key}" is not registered for ${purpose}.`);
    }
    return registered;
  };

  // Tracks *why* the next scheduler flush is happening. The scheduler's
  // `schedule()` takes no arguments and flushes on a microtask, so the
  // reason has to be recorded ahead of time by whichever trigger requested
  // the run, then read back when the flush actually executes.
  const schedulerRequest = createSchedulerRequestTracker("subscription");

  const { execution, scheduler, subscriptions, invalidation } = createGraphCoordination({
    graph,
    diagnostics,
    getNodeState,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    getActiveAttempts,
    notify: emitNotify,
    requireRegisteredNode,
    schedulerRequest,
    operationObservation,
    maxConcurrentLoads: options?.maxConcurrentLoads,
  });

  // Every caller-facing operation announces itself (`operation.<kind>.requested`)
  // and then runs with that operation's id as its diagnostic context, so all
  // downstream events are attributed to it. `reason` is the execution reason
  // stamped on those events - the same as `operation`, except that a plain
  // `execute` is reported as "explicit".
  const requestOperation = <TResult>(
    operation: RequestedOperation,
    reason: GraphExecutionReason,
    nodes: readonly AnyNodeDefinition[],
    run: (diagnosticContext: ExecutionDiagnosticContext) => TResult,
    queryKey?: string,
  ): TResult => {
    const operationId = diagnostics.emitOperationRequested({
      type: `operation.${operation}.requested`,
      operation,
      nodeKeys: nodes.map((node) => node.key),
      ...(queryKey === undefined ? {} : { queryKey }),
    });
    return run({ operationId, reason });
  };

  const events = createRuntimeEventMatcher({
    graph,
    getNodeState,
  });

  const graphCommit = createGraphCommitCoordinator({
    matchPublications: events.matchPublications,
    commitContexts: invalidation.commitContexts,
    schedule: scheduler.schedule,
    notify: emitNotify,
    schedulerRequest,
    operationObservation,
    diagnostics,
  });

  const transactions = createRuntimeTransactionCoordinator({
    resolveContextNode: invalidation.resolveContextNode,
    getContextGeneration: (node) => getNodeState(node.key).generation,
    commitImmediate: graphCommit.commitImmediate,
    commitTransaction: graphCommit.commitTransaction,
  });

  const operations = createRuntimeOperationsController({
    getNodeState,
    getActiveAttempt,
    resolveRegisteredNode: requireRegisteredNode,
    execute: (targets, origin, diagnosticContext) =>
      execution.execute(targets, origin, diagnosticContext),
    notify: emitNotify,
  });

  const mutations = createRuntimeMutationController({
    resolveRegisteredNode: requireRegisteredNode,
    getNodeState,
    getActiveAttempt,
    hasSubscribers: subscriptions.hasSubscribers,
    matchPublications: events.matchPublications,
    prepareCombinedInvalidation: invalidation.prepareCombinedInvalidation,
    notify: emitNotify,
    schedule: scheduler.schedule,
  });

  const policies = createRuntimePolicyServices({
    graph,
    diagnostics,
    timerEnvironment: options?.timerEnvironment,
    releaseAfterMs: options?.releaseAfterMs,
    getNodeState,
    hasSubscribers: subscriptions.hasSubscribers,
    refreshPolicyNode: operations.refreshPolicyNode,
    notify: emitNotify,
    onChange,
  });
  diagnostics.emitRuntimeCreated(graph.getNodes().map((node) => node.key));

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) => getSnapshot(node),
    setContext: <TValue>(node: ContextNodeDefinition<TValue>, value: TValue) => {
      const operationId = diagnostics.createOperationId();
      schedulerRequest.request("context-invalidation", operationId);
      operationObservation.runObserved({ operationId, reason: "context-invalidation" }, () =>
        transactions.setContext(node, value),
      );
    },
    execute: (targets: readonly AnyNodeDefinition[]) =>
      requestOperation("execute", "explicit", targets, (context) =>
        execution.execute(targets, "explicit", context),
      ),
    prefetch: (nodes: readonly AnyNodeDefinition[]) =>
      requestOperation("prefetch", "prefetch", nodes, (context) =>
        operations.prefetch(nodes, context),
      ),
    prefetchQuery: (query: AnyQueryDefinition) => {
      const nodes = getQueryNodes(query);
      return requestOperation(
        "query-prefetch",
        "query-prefetch",
        nodes,
        (context) => operations.prefetch(nodes, context),
        query.key,
      );
    },
    refresh: (nodes: readonly RefreshableNodeDefinition[]) =>
      requestOperation("refresh", "refresh", nodes, (context) =>
        operations.refresh(nodes, context),
      ),
    refreshQuery: (query: AnyQueryDefinition) => {
      const nodes = getQueryRefreshableNodes(query);
      return requestOperation(
        "query-refresh",
        "query-refresh",
        nodes,
        (context) => operations.refresh(nodes, context),
        query.key,
      );
    },
    publish: <TEvent extends AnyEventDefinition>(event: TEvent, payload: EventPayload<TEvent>) => {
      const operationId = diagnostics.createOperationId();
      operationObservation.runObserved({ operationId, reason: "context-invalidation" }, () =>
        transactions.publish(event, payload),
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
    createDiagnosticSnapshot: () =>
      createDiagnosticSnapshot({
        graph,
        runtimeId: diagnostics.runtimeId,
        now: diagnostics.now,
        getNodeState,
        getSchedulerState: scheduler.getSchedulerState,
        getSubscriptionState: subscriptions.getSubscriptionState,
        getRefreshPolicySnapshot: policies.getRefreshPolicyDiagnosticSnapshot,
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
    dispose: policies.dispose,
  });
};
