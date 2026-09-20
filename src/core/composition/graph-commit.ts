import type { RuntimeDiagnosticEmitter } from "../diagnostics/diagnostic-emitter";
import type { OperationObservationTracker } from "../diagnostics/operation-observation";
import type { RuntimeEventMatcher } from "../events/event-matcher";
import type { RuntimeInvalidationController } from "../invalidation/invalidation";
import type { SchedulerRequestTracker } from "../scheduling/request-tracker";
import type { RuntimeSchedulerController } from "../scheduling/scheduler";
import type {
  ContextChange,
  EventPublication,
  TransactionCommitContext,
} from "../transactions/types";

export interface GraphCommitDependencies {
  readonly matchPublications: RuntimeEventMatcher["matchPublications"];
  readonly commitContexts: RuntimeInvalidationController["commitContexts"];
  readonly schedule: RuntimeSchedulerController["schedule"];
  readonly notify: () => void;
  readonly schedulerRequest: SchedulerRequestTracker;
  readonly operationObservation: OperationObservationTracker;
  readonly diagnostics: RuntimeDiagnosticEmitter;
}

export interface GraphCommitCoordinator {
  /** Applies context writes and event publications outside a transaction. */
  readonly commitImmediate: (
    contextChanges: readonly ContextChange[],
    eventPublications: readonly EventPublication[],
  ) => void;
  /** Applies a transaction's staged writes and publications on commit. */
  readonly commitTransaction: (
    contextChanges: readonly ContextChange[],
    eventPublications: readonly EventPublication[],
    commitContext?: TransactionCommitContext,
  ) => void;
}

/**
 * The graph commit pipeline: context changes + event publications ->
 * event matching -> diagnostics -> context invalidation -> scheduler.
 *
 * This is the one place that turns "these writes/publications happened" into
 * invalidation and scheduling, for both immediate writes and transaction
 * commits. Attribution rules live here and must not drift:
 *
 * - the operation id is the commit context's, else the currently observed
 *   operation's, else a fresh one. `||` is deliberate: with diagnostics
 *   disabled every operation id is the empty string, and an empty id counts
 *   as "no operation" and must fall through, which `??` would not do;
 * - the scheduler is asked for a `context-invalidation` flush caused by that
 *   operation *before* matching runs, and the whole pipeline executes inside
 *   an observation of that operation.
 */
export const createGraphCommitCoordinator = ({
  matchPublications,
  commitContexts,
  schedule,
  notify,
  schedulerRequest,
  operationObservation,
  diagnostics,
}: GraphCommitDependencies): GraphCommitCoordinator => {
  const commit = (
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
        const eventTargets = matchPublications(eventPublications, {
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
        commitContexts(
          contextChanges,
          eventTargets,
          immediate ? { notify, schedule } : undefined,
        );
      },
    );
  };

  const coordinator: GraphCommitCoordinator = {
    commitImmediate: (contextChanges, eventPublications) =>
      commit(contextChanges, eventPublications, true),
    commitTransaction: (contextChanges, eventPublications, commitContext) =>
      commit(contextChanges, eventPublications, false, commitContext),
  };
  return Object.freeze(coordinator);
};
