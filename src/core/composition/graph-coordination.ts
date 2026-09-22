import type { RuntimeDiagnosticEmitter } from "../diagnostics/diagnostic-emitter";
import type { OperationObservationTracker } from "../diagnostics/operation-observation";
import { createExecutionConcurrencyLimiter } from "../execution/concurrency-limiter";
import {
  createRuntimeExecutionController,
  type RuntimeExecutionController,
} from "../execution/execution";
import type { AnyNodeDefinition, Graph } from "../graph/types";
import {
  createRuntimeInvalidationController,
  type RuntimeInvalidationController,
} from "../invalidation/invalidation";
import type { SchedulerRequestTracker } from "../scheduling/request-tracker";
import {
  createRuntimeSchedulerController,
  type RuntimeSchedulerController,
} from "../scheduling/scheduler";
import type { ActiveAttempt, RuntimeStateStore } from "../state/state";
import {
  createRuntimeSubscriptionController,
  type RuntimeSubscriptionController,
} from "../subscriptions/subscriptions";
import { createLateBinding } from "../util/late-binding";
import { createSchedulerDiagnostics } from "./scheduler-diagnostics";

export interface GraphCoordinationDependencies {
  readonly graph: Graph;
  readonly diagnostics: RuntimeDiagnosticEmitter;
  readonly getNodeState: RuntimeStateStore["getNodeState"];
  readonly getActiveAttempt: RuntimeStateStore["getActiveAttempt"];
  readonly setActiveAttempt: RuntimeStateStore["setActiveAttempt"];
  readonly deleteActiveAttempt: RuntimeStateStore["deleteActiveAttempt"];
  readonly getActiveAttempts: RuntimeStateStore["getActiveAttempts"];
  readonly notify: () => void;
  readonly requireRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string,
  ) => AnyNodeDefinition;
  /** Shared with the commit pipeline and the public facade; one per runtime. */
  readonly schedulerRequest: SchedulerRequestTracker;
  /** Shared with the commit pipeline and the public facade; one per runtime. */
  readonly operationObservation: OperationObservationTracker;
  /** The runtime's `maxConcurrentLoads` option. */
  readonly maxConcurrentLoads: number | undefined;
}

export interface GraphCoordination {
  readonly execution: RuntimeExecutionController;
  readonly scheduler: RuntimeSchedulerController;
  readonly subscriptions: RuntimeSubscriptionController;
  readonly invalidation: RuntimeInvalidationController;
}

const isAutomaticOnlyAttempt = (attempt: ActiveAttempt): boolean =>
  [...attempt.origins].every(
    (origin) => origin === "scheduler" || origin === "refresh-policy",
  );

/**
 * Builds the four controllers that depend on one another - execution,
 * scheduler, subscriptions, invalidation - and connects them.
 *
 * Their dependency structure, which is why this lives in one place:
 *
 *   scheduler      -> execution (eager: runs and asks what needs running)
 *   subscriptions  -> scheduler (eager: schedules after subscribe/unsubscribe)
 *   invalidation   -> subscriptions, scheduler (eager)
 *   execution      -> invalidation   (LATE: a changed refresh result
 *                                     invalidates descendants)
 *   scheduler      -> subscriptions  (LATE: which nodes are directly
 *                                     subscribed, read on each flush)
 *
 * The eager edges fix the construction order below. The two late edges point
 * backwards along it, so they are read through guarded late bindings that
 * throw a named error if touched before assignment. Both are only ever read
 * from inside callbacks that run after construction. Do not reorder the
 * construction without re-checking these edges.
 *
 * A controller's own callback reading that same controller (subscriptions'
 * `afterUnsubscribe`) is not a back-edge: it runs after construction, so it
 * reads the `const` directly (annotated, so its type does not depend on its
 * own initializer).
 *
 * `schedulerRequest` and `operationObservation` are deliberately *inputs*, not
 * created here: the commit pipeline and the public facade share the same
 * single instances, and diagnostic attribution silently breaks if any of them
 * ends up with its own copy.
 */
export const createGraphCoordination = ({
  graph,
  diagnostics,
  getNodeState,
  getActiveAttempt,
  setActiveAttempt,
  deleteActiveAttempt,
  getActiveAttempts,
  notify,
  requireRegisteredNode,
  schedulerRequest,
  operationObservation,
  maxConcurrentLoads,
}: GraphCoordinationDependencies): GraphCoordination => {
  const subscriptionsBinding =
    createLateBinding<RuntimeSubscriptionController>("subscriptions");
  const invalidationBinding =
    createLateBinding<RuntimeInvalidationController>("invalidation");

  const schedulerDiagnostics = createSchedulerDiagnostics({
    diagnostics,
    schedulerRequest,
  });

  const execution = createRuntimeExecutionController({
    graph,
    concurrencyLimiter: createExecutionConcurrencyLimiter(
      maxConcurrentLoads ?? Infinity,
    ),
    getNodeState,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    resolveRegisteredNode: (node) => requireRegisteredNode(node, "execution"),
    notify,
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

  const getSubscribedTargetsNeedingWork = (): readonly AnyNodeDefinition[] =>
    graph.getNodes().filter((node) => {
      if (node.kind === "context") return false;
      if (!subscriptionsBinding.get().hasDirectSubscribers(node)) return false;
      // Flushes can now overlap (see scheduler.ts), so a node already being
      // worked on by an earlier flush must not become a second flush's
      // target: that would duplicate the "started"/"completed" attribution
      // for work that is really one attempt. `executeNode` already reuses an
      // attempt with a matching generation; this keeps the *scheduler* from
      // treating that reuse as new work to schedule. An attempt whose signal
      // has already been aborted no longer counts - it is on its way out and
      // must not block the node from being picked up again.
      const inFlight = getActiveAttempt(node.key);
      if (inFlight !== undefined && !inFlight.controller.signal.aborted) {
        return false;
      }
      return execution.needsExecution(node);
    });

  const scheduler = createRuntimeSchedulerController({
    getTargetsNeedingWork: getSubscribedTargetsNeedingWork,
    execute: (targets, context) =>
      execution.execute(targets, "scheduler", context),
    notify,
    onRequested: schedulerDiagnostics.onRequested,
    beginFlush: schedulerDiagnostics.beginFlush,
  });

  const subscriptions: RuntimeSubscriptionController = createRuntimeSubscriptionController({
    graph,
    resolveRegisteredNode: requireRegisteredNode,
    notify,
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
          !subscriptions.hasSubscribers(node) &&
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
    getNodeState,
    getActiveAttempt,
    hasSubscribers: subscriptions.hasSubscribers,
    resolveRegisteredNode: requireRegisteredNode,
    notify,
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

  return Object.freeze({ execution, scheduler, subscriptions, invalidation });
};
