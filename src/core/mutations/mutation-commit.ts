import type { AnyNodeDefinition } from "../graph/types";
import type { CombinedInvalidationPlan } from "../invalidation/invalidation";
import type { ActiveAttempt, MutableNodeRuntimeState } from "../state/state";
import type { OptimisticSession } from "./optimistic-session";
import type { PreparedMutationUpdate } from "./mutation-update-planner";

export interface MutationCommitter {
  readonly commitOptimistic: (
    updates: readonly PreparedMutationUpdate[],
    invalidation: CombinedInvalidationPlan,
  ) => void;
  readonly commitSuccess: (
    updates: readonly PreparedMutationUpdate[],
    invalidation: CombinedInvalidationPlan,
  ) => void;
  readonly commitRollback: (
    session: OptimisticSession,
    shouldSchedule: boolean,
  ) => void;
  readonly commitStaleReconciliation: (
    session: OptimisticSession,
  ) => void;
}

export interface MutationCommitterDependencies {
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
  readonly getActiveAttempt: (key: string) => ActiveAttempt | undefined;
  readonly prepareCombinedInvalidation: (
    changedResultRoots: readonly AnyNodeDefinition[],
    invalidationRoots: readonly AnyNodeDefinition[],
    preservedRoots: readonly AnyNodeDefinition[],
  ) => CombinedInvalidationPlan;
  readonly releaseOptimisticSession: (
    session: OptimisticSession | undefined,
  ) => void;
  readonly notify: () => void;
  readonly schedule: () => void;
}

export const createMutationCommitter = ({
  getMutableState,
  getActiveAttempt,
  prepareCombinedInvalidation,
  releaseOptimisticSession,
  notify,
  schedule,
}: MutationCommitterDependencies): MutationCommitter => {
  const commitOptimistic = (
    updates: readonly PreparedMutationUpdate[],
    invalidation: CombinedInvalidationPlan,
  ): void => {
    for (const { state, value } of updates) {
      state.data = value;
      state.status = "success";
      state.freshness = "fresh";
      state.error = null;
      state.generation += 1;
    }
    invalidation.commit();
    for (const { node } of updates) {
      getActiveAttempt(node.key)?.controller.abort();
    }

    notify();
    if (invalidation.subscribedNodeChanged) schedule();
  };

  const commitSuccess = (
    updates: readonly PreparedMutationUpdate[],
    invalidation: CombinedInvalidationPlan,
  ): void => {
    const effectiveUpdates = updates.filter(
      ({ node, changed }) =>
        changed || invalidation.affectedPreservedKeys.has(node.key),
    );

    for (const { node, state, value } of effectiveUpdates) {
      state.data = value;
      state.status = "success";
      state.freshness = invalidation.affectedPreservedKeys.has(node.key)
        ? "stale"
        : "fresh";
      state.error = null;
      state.generation += 1;
    }
    invalidation.commit();
    for (const { node } of effectiveUpdates) {
      getActiveAttempt(node.key)?.controller.abort();
    }

    if (effectiveUpdates.length === 0 && invalidation.affectedNodes.length === 0) {
      return;
    }
    notify();
    if (invalidation.subscribedNodeChanged) schedule();
  };

  const commitRollback = (
    session: OptimisticSession,
    shouldSchedule: boolean,
  ): void => {
    for (const snapshot of session.snapshots) {
      const state = getMutableState(snapshot.node.key);
      state.data = snapshot.data;
      state.status = snapshot.status;
      state.freshness = snapshot.freshness;
      state.error = snapshot.error;
      state.generation += 1;
      state.hasSuccessfulValue = snapshot.hasSuccessfulValue;
    }
    for (const snapshot of session.snapshots) {
      getActiveAttempt(snapshot.node.key)?.controller.abort();
    }

    releaseOptimisticSession(session);
    notify();
    if (shouldSchedule) schedule();
  };

  const commitStaleReconciliation = (
    session: OptimisticSession,
  ): void => {
    const invalidation = prepareCombinedInvalidation([], session.targets, []);
    invalidation.commit();
    releaseOptimisticSession(session);
    notify();
    if (invalidation.subscribedNodeChanged) schedule();
  };

  return Object.freeze({
    commitOptimistic,
    commitSuccess,
    commitRollback,
    commitStaleReconciliation,
  });
};
