import type { EventMatchOptions } from "../events/event-matcher";
import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { AnyNodeDefinition } from "../graph/types";
import type { CombinedInvalidationPlan } from "../invalidation/invalidation";
import type { RefreshableNodeDefinition } from "../operations/types";
import type { EventPublication } from "../transactions/types";
import {
  GraphMutationOutcomeUnknownError,
  GraphMutationReconciliationError,
  GraphMutationRollbackConflictError,
  GraphMutationStateError,
} from "./errors";
import type { MutationCommitter } from "./mutation-commit";
import type {
  OptimisticSession,
  OptimisticSessionManager,
} from "./optimistic-session";
import type { MutationUpdatePlanner } from "./mutation-update-planner";
import type {
  MutationOptions,
  MutationSuccessEffects,
} from "./types";

export interface MutationSettlementCoordinator {
  readonly settleSuccess: <TInput, TResult>(
    mutationKey: string,
    options: MutationOptions<TInput, TResult> | undefined,
    result: TResult,
    input: TInput,
    optimistic: OptimisticSession | undefined,
  ) => TResult;
  readonly settleFailure: <TInput, TResult>(
    options: MutationOptions<TInput, TResult> | undefined,
    error: unknown,
    optimistic: OptimisticSession | undefined,
  ) => never;
}

export interface MutationSettlementDependencies {
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string,
  ) => AnyNodeDefinition;
  readonly matchPublications: (
    publications: readonly EventPublication[],
    options?: EventMatchOptions,
  ) => readonly AnyNodeDefinition[];
  readonly prepareCombinedInvalidation: (
    changedResultRoots: readonly AnyNodeDefinition[],
    invalidationRoots: readonly AnyNodeDefinition[],
    preservedRoots: readonly AnyNodeDefinition[],
  ) => CombinedInvalidationPlan;
  readonly updatePlanner: MutationUpdatePlanner;
  readonly optimisticSessions: OptimisticSessionManager;
  readonly mutationCommitter: MutationCommitter;
}

export const createMutationSettlementCoordinator = ({
  resolveRegisteredNode,
  matchPublications,
  prepareCombinedInvalidation,
  updatePlanner,
  optimisticSessions,
  mutationCommitter,
}: MutationSettlementDependencies): MutationSettlementCoordinator => {
  const applySuccessEffects = <TInput, TResult>(
    options: MutationOptions<TInput, TResult>,
    result: TResult,
    input: TInput,
    optimisticTargets: readonly AnyNodeDefinition[] = [],
  ): void => {
    if (!options.onSuccess) return;

    const invalidationRoots = new Map<string, AnyNodeDefinition>();
    const publications: EventPublication[] = [];
    const updateDrafts = updatePlanner.collect(successUpdates => {
      let acceptingEffects = true;
      const effects: MutationSuccessEffects = Object.freeze({
        update: successUpdates.update,
        invalidate: (nodes: readonly RefreshableNodeDefinition[]): void => {
          if (!acceptingEffects) {
            throw new Error("Mutation success effects are no longer active.");
          }
          const registeredNodes = nodes.map(node =>
            resolveRegisteredNode(node, "mutation invalidation"),
          );
          for (const registered of registeredNodes) {
            if (registered.kind === "context") {
              throw new GraphMutationStateError(
                registered.key,
                `Context node "${registered.key}" cannot be invalidated by a mutation.`,
              );
            }
            invalidationRoots.set(registered.key, registered);
          }
        },
        publish: <TEvent extends AnyEventDefinition>(
          event: TEvent,
          payload: EventPayload<TEvent>,
        ): void => {
          if (!acceptingEffects) {
            throw new Error("Mutation success effects are no longer active.");
          }
          publications.push({ event, payload });
        },
      });
      try {
        return options.onSuccess?.(effects, result, input);
      } finally {
        acceptingEffects = false;
      }
    }, "success");

    const prepared = updatePlanner.prepare(updateDrafts);
    const changedUpdates = prepared.filter(update => update.changed);
    const preliminaryInvalidation = prepareCombinedInvalidation(
      [
        ...optimisticTargets,
        ...changedUpdates.map(({ node }) => node),
      ],
      [...invalidationRoots.values()],
      prepared.map(({ node }) => node),
    );
    const affectedDerivedKeys = new Set(
      preliminaryInvalidation.affectedNodes
        .filter(node => node.kind === "derived")
        .map(node => node.key),
    );
    const eventTargets = matchPublications(publications, {
      valueOverlay: prepared.map(({ node, value }) => ({ node, value })),
      prohibitedDependencyKeys: affectedDerivedKeys,
    });
    for (const node of eventTargets) invalidationRoots.set(node.key, node);

    const invalidation = prepareCombinedInvalidation(
      changedUpdates.map(({ node }) => node),
      [...invalidationRoots.values()],
      prepared.map(({ node }) => node),
    );
    mutationCommitter.commitSuccess(prepared, invalidation);
  };

  const settleReconciliationFailure = (
    mutationKey: string,
    optimistic: OptimisticSession,
    error: unknown,
  ): never => {
    mutationCommitter.commitStaleReconciliation(optimistic);
    throw new GraphMutationReconciliationError(
      mutationKey,
      optimistic.snapshots.map(snapshot => snapshot.node.key),
      error,
    );
  };

  const settleSuccess = <TInput, TResult>(
    mutationKey: string,
    options: MutationOptions<TInput, TResult> | undefined,
    result: TResult,
    input: TInput,
    optimistic: OptimisticSession | undefined,
  ): TResult => {
    try {
      if (options) {
        applySuccessEffects(options, result, input, optimistic?.targets);
      }
      optimisticSessions.release(optimistic);
      return result;
    } catch (error) {
      if (!optimistic) throw error;
      return settleReconciliationFailure(mutationKey, optimistic, error);
    }
  };

  const settleRollbackConflict = (
    optimistic: OptimisticSession,
    conflictingKeys: readonly string[],
    error: unknown,
  ): never => {
    mutationCommitter.commitStaleReconciliation(optimistic);
    throw new GraphMutationRollbackConflictError(conflictingKeys, error);
  };

  const settleKnownRejection = (
    optimistic: OptimisticSession,
    error: unknown,
  ): never => {
    const conflictingKeys = optimisticSessions.getRollbackConflicts(optimistic);
    if (conflictingKeys.length > 0) {
      return settleRollbackConflict(optimistic, conflictingKeys, error);
    }

    mutationCommitter.commitRollback(
      optimistic,
      optimisticSessions.shouldScheduleRestoredState(optimistic),
    );
    throw error;
  };

  const settleUnknownOutcome = (
    optimistic: OptimisticSession,
    error: unknown,
  ): never => {
    mutationCommitter.commitStaleReconciliation(optimistic);
    throw new GraphMutationOutcomeUnknownError(
      optimistic.targets.map(node => node.key),
      error,
    );
  };

  const settleFailure = <TInput, TResult>(
    options: MutationOptions<TInput, TResult> | undefined,
    error: unknown,
    optimistic: OptimisticSession | undefined,
  ): never => {
    if (!optimistic) throw error;

    let failureKind: "rejected" | "unknown" = "unknown";
    try {
      if (options?.classifyFailure?.(error) === "rejected") {
        failureKind = "rejected";
      }
    } catch {
      // A classifier failure cannot prove remote rejection. Preserve the safe
      // unknown-outcome path and retain the remote error as cause.
    }

    return failureKind === "rejected"
      ? settleKnownRejection(optimistic, error)
      : settleUnknownOutcome(optimistic, error);
  };

  return Object.freeze({ settleSuccess, settleFailure });
};
