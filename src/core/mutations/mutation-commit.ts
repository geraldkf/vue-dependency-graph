import type { AnyNodeDefinition } from "../graph/types";
import type { CombinedInvalidationPlan } from "../invalidation/invalidation";
import type { ActiveAttempt, NodeStateRecord } from "../state/state";
import { restoreSnapshot, writeValue } from "../state/transitions";
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
  readonly commitRollback: (session: OptimisticSession, shouldSchedule: boolean) => void;
  readonly commitStaleReconciliation: (session: OptimisticSession) => void;
}

export interface MutationCommitterDependencies {
  readonly getNodeState: (key: string) => NodeStateRecord;
  readonly getActiveAttempt: (key: string) => ActiveAttempt | undefined;
  readonly prepareCombinedInvalidation: (
    changedResultRoots: readonly AnyNodeDefinition[],
    invalidationRoots: readonly AnyNodeDefinition[],
    preservedRoots: readonly AnyNodeDefinition[],
  ) => CombinedInvalidationPlan;
  readonly releaseOptimisticSession: (session: OptimisticSession | undefined) => void;
  readonly notify: () => void;
  readonly schedule: () => void;
}

export const createMutationCommitter = ({
  getNodeState,
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
      writeValue(state, value, "fresh");
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
      ({ node, changed }) => changed || invalidation.affectedPreservedKeys.has(node.key),
    );

    for (const { node, state, value } of effectiveUpdates) {
      writeValue(
        state,
        value,
        invalidation.affectedPreservedKeys.has(node.key) ? "stale" : "fresh",
      );
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

  const commitRollback = (session: OptimisticSession, shouldSchedule: boolean): void => {
    for (const snapshot of session.snapshots) {
      restoreSnapshot(getNodeState(snapshot.node.key), snapshot);
    }
    for (const snapshot of session.snapshots) {
      getActiveAttempt(snapshot.node.key)?.controller.abort();
    }

    releaseOptimisticSession(session);
    notify();
    if (shouldSchedule) schedule();
  };

  const commitStaleReconciliation = (session: OptimisticSession): void => {
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
