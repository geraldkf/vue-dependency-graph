import type { EventMatchOptions } from "../events/event-matcher";
import type { AnyEventDefinition, EventPayload } from "../events/types";
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DependencyList,
  EventInvalidationList,
} from "../graph/types";
import type { CombinedInvalidationPlan } from "../invalidation/invalidation";
import type { RefreshableNodeDefinition } from "../operations/types";
import type { ActiveAttempt, MutableNodeRuntimeState } from "../state/state";
import type { EventPublication } from "../transactions/types";
import {
  GraphMutationConflictError,
  GraphMutationOutcomeUnknownError,
  GraphMutationReconciliationError,
  GraphMutationRollbackConflictError,
  GraphMutationStateError,
} from "./errors";
import type {
  MutationDefinition,
  MutationOptions,
  MutationSuccessEffects,
  MutationUpdateEffects,
} from "./types";
import {
  guardMutationUpdaterValue,
  isMutationValueMutationError,
} from "./mutation-value-guard";

interface MutationUpdateDraft {
  readonly node: AnyNodeDefinition;
  readonly updater: (current: unknown) => unknown;
}

interface PreparedMutationUpdate {
  readonly node: AnyNodeDefinition;
  readonly state: MutableNodeRuntimeState;
  readonly value: unknown;
  readonly changed: boolean;
}

interface MutationStateSnapshot {
  readonly node: AnyNodeDefinition;
  readonly data: unknown;
  readonly status: MutableNodeRuntimeState["status"];
  readonly freshness: MutableNodeRuntimeState["freshness"];
  readonly error: Error | null;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
}

interface OptimisticSession {
  readonly token: symbol;
  readonly targets: readonly AnyNodeDefinition[];
  readonly snapshots: readonly MutationStateSnapshot[];
  readonly expectedGenerations: ReadonlyMap<string, number>;
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

export interface RuntimeMutationController {
  readonly mutate: <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    options?: MutationOptions<TInput, TResult>,
  ) => Promise<TResult>;
}

export interface RuntimeMutationControllerDependencies {
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string,
  ) => AnyNodeDefinition;
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
  readonly getActiveAttempt: (key: string) => ActiveAttempt | undefined;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  readonly matchPublications: (
    publications: readonly EventPublication[],
    options?: EventMatchOptions,
  ) => readonly AnyNodeDefinition[];
  readonly prepareCombinedInvalidation: (
    changedResultRoots: readonly AnyNodeDefinition[],
    invalidationRoots: readonly AnyNodeDefinition[],
    preservedRoots: readonly AnyNodeDefinition[],
  ) => CombinedInvalidationPlan;
  readonly notify: () => void;
  readonly schedule: () => void;
}

/**
 * Owns caller-driven mutation execution, atomic success reconciliation, and
 * optimistic snapshot lifetime. Rollback restores logical snapshot state but
 * always advances generations so obsolete work can never become current again.
 */
export const createRuntimeMutationController = ({
  resolveRegisteredNode,
  getMutableState,
  getActiveAttempt,
  hasSubscribers,
  matchPublications,
  prepareCombinedInvalidation,
  notify,
  schedule,
}: RuntimeMutationControllerDependencies): RuntimeMutationController => {
  const optimisticOwners = new Map<string, symbol>();

  const collectUpdates = (
    work: (effects: MutationUpdateEffects) => void,
    operation: "optimistic" | "success",
  ): readonly MutationUpdateDraft[] => {
    const drafts: MutationUpdateDraft[] = [];
    const targetKeys = new Set<string>();
    let acceptingEffects = true;

    const effects: MutationUpdateEffects = Object.freeze({
      update: <
        TValue,
        TDependencies extends DependencyList,
        TInvalidatedBy extends EventInvalidationList<TDependencies>,
      >(
        node: DataNodeDefinition<TValue, TDependencies, TInvalidatedBy>,
        updater: (current: TValue) => TValue,
      ): void => {
        if (!acceptingEffects) {
          throw new Error(`Mutation ${operation} effects are no longer active.`);
        }
        const registered = resolveRegisteredNode(
          node,
          `mutation ${operation} update`,
        );
        if (registered.kind !== "data") {
          throw new GraphMutationStateError(
            registered.key,
            `Node "${registered.key}" is not a data node and cannot be updated by a mutation.`,
          );
        }
        if (targetKeys.has(registered.key)) {
          throw new GraphMutationStateError(
            registered.key,
            `Mutation ${operation} effects cannot update node "${registered.key}" more than once.`,
          );
        }
        targetKeys.add(registered.key);
        drafts.push({
          node: registered,
          updater: updater as (current: unknown) => unknown,
        });
      },
    });

    let callbackResult: unknown;
    try {
      callbackResult = work(effects);
    } finally {
      acceptingEffects = false;
    }
    if (isPromiseLike(callbackResult)) {
      void Promise.resolve(callbackResult).catch(() => undefined);
      throw new Error(`Mutation ${operation} effects must be synchronous.`);
    }

    return drafts;
  };

  const prepareUpdates = (
    drafts: readonly MutationUpdateDraft[],
  ): readonly PreparedMutationUpdate[] => {
    const validated = drafts.map(({ node, updater }) => {
      const state = getMutableState(node.key);
      if (!state.hasSuccessfulValue) {
        throw new GraphMutationStateError(
          node.key,
          `Node "${node.key}" does not have a successful value to update.`,
        );
      }
      return { node, state, updater };
    });

    return validated.map(({ node, state, updater }) => {
      const guarded = guardMutationUpdaterValue(state.data);
      let value: unknown;
      try {
        value = guarded.unwrap(updater(guarded.current));
      } catch (error) {
        if (isMutationValueMutationError(error)) {
          throw new GraphMutationStateError(
            node.key,
            `Mutation updater for node "${node.key}" must not modify the current value.`,
          );
        }
        throw error;
      }
      if (isPromiseLike(value)) {
        void Promise.resolve(value).catch(() => undefined);
        throw new GraphMutationStateError(
          node.key,
          `Mutation updater for node "${node.key}" must be synchronous.`,
        );
      }
      return {
        node,
        state,
        value,
        changed:
          !Object.is(state.data, value) ||
          state.status !== "success" ||
          state.freshness !== "fresh" ||
          state.error !== null,
      };
    });
  };

  const snapshotNodes = (
    nodes: readonly AnyNodeDefinition[],
  ): readonly MutationStateSnapshot[] => {
    const unique = new Map(nodes.map(node => [node.key, node]));
    return Object.freeze(
      [...unique.values()].map(node => {
        const state = getMutableState(node.key);
        return Object.freeze({
          node,
          data: state.data,
          status: state.status,
          freshness: state.freshness,
          error: state.error,
          generation: state.generation,
          hasSuccessfulValue: state.hasSuccessfulValue,
        });
      }),
    );
  };

  const applyOptimistic = <TInput>(
    work: NonNullable<MutationOptions<TInput, unknown>["optimistic"]>,
    input: TInput,
  ): OptimisticSession | undefined => {
    const prepared = prepareUpdates(
      collectUpdates(effects => work(effects, input), "optimistic"),
    );
    const changed = prepared.filter(update => update.changed);
    if (changed.length === 0) return undefined;

    const conflicts = changed
      .filter(({ node }) => optimisticOwners.has(node.key))
      .map(({ node }) => node.key);
    if (conflicts.length > 0) {
      throw new GraphMutationConflictError(conflicts);
    }

    const invalidation = prepareCombinedInvalidation(
      changed.map(({ node }) => node),
      [],
      changed.map(({ node }) => node),
    );
    const snapshots = snapshotNodes([
      ...changed.map(({ node }) => node),
      ...invalidation.affectedNodes,
    ]);
    const token = Symbol("optimistic-mutation");

    for (const { node } of changed) optimisticOwners.set(node.key, token);
    for (const { state, value } of changed) {
      state.data = value;
      state.status = "success";
      state.freshness = "fresh";
      state.error = null;
      state.generation += 1;
    }
    invalidation.commit();
    for (const { node } of changed) {
      getActiveAttempt(node.key)?.controller.abort();
    }

    notify();
    if (invalidation.subscribedNodeChanged) schedule();

    return Object.freeze({
      token,
      targets: Object.freeze(changed.map(({ node }) => node)),
      snapshots,
      expectedGenerations: new Map(
        snapshots.map(snapshot => [
          snapshot.node.key,
          getMutableState(snapshot.node.key).generation,
        ]),
      ),
    });
  };

  const releaseOptimisticOwnership = (
    session: OptimisticSession | undefined,
  ): void => {
    if (!session) return;
    for (const node of session.targets) {
      if (optimisticOwners.get(node.key) === session.token) {
        optimisticOwners.delete(node.key);
      }
    }
  };

  const reconcileOptimisticState = (session: OptimisticSession): void => {
    const invalidation = prepareCombinedInvalidation([], session.targets, []);
    invalidation.commit();
    releaseOptimisticOwnership(session);
    notify();
    if (invalidation.subscribedNodeChanged) schedule();
  };

  const rollbackOptimistic = (
    session: OptimisticSession,
    cause: unknown,
  ): void => {
    const conflictingKeys = new Set<string>();
    for (const target of session.targets) {
      if (optimisticOwners.get(target.key) !== session.token) {
        conflictingKeys.add(target.key);
      }
    }
    const targetKeys = new Set(session.targets.map(node => node.key));
    for (const snapshot of session.snapshots) {
      const state = getMutableState(snapshot.node.key);
      if (
        state.generation !== session.expectedGenerations.get(snapshot.node.key) ||
        (
          !targetKeys.has(snapshot.node.key) &&
          snapshot.node.kind === "data" &&
          state.status === "success" &&
          state.freshness === "fresh" &&
          !Object.is(state.data, snapshot.data)
        )
      ) {
        conflictingKeys.add(snapshot.node.key);
      }
    }

    if (conflictingKeys.size > 0) {
      reconcileOptimisticState(session);
      throw new GraphMutationRollbackConflictError(
        [...conflictingKeys],
        cause,
      );
    }

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
    const shouldSchedule = session.snapshots.some(
      snapshot =>
        snapshot.freshness === "stale" && hasSubscribers(snapshot.node),
    );
    releaseOptimisticOwnership(session);
    notify();
    if (shouldSchedule) schedule();
  };

  const applySuccessEffects = <TInput, TResult>(
    options: MutationOptions<TInput, TResult>,
    result: TResult,
    input: TInput,
    optimisticTargets: readonly AnyNodeDefinition[] = [],
  ): void => {
    if (!options.onSuccess) return;

    const invalidationRoots = new Map<string, AnyNodeDefinition>();
    const publications: EventPublication[] = [];
    const updateDrafts = collectUpdates(successUpdates => {
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

    const prepared = prepareUpdates(updateDrafts);
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
    const effectiveUpdates = prepared.filter(
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

    if (effectiveUpdates.length === 0 && !invalidation.hasAffectedNodes) return;
    notify();
    if (invalidation.subscribedNodeChanged) schedule();
  };

  const mutate = <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    options?: MutationOptions<TInput, TResult>,
  ): Promise<TResult> => {
    const controller = new AbortController();
    let optimistic: OptimisticSession | undefined;

    return Promise.resolve()
      .then(() => {
        if (options?.optimistic) {
          optimistic = applyOptimistic(
            options.optimistic as NonNullable<
              MutationOptions<TInput, unknown>["optimistic"]
            >,
            input,
          );
        }
        return mutation.execute({ input, signal: controller.signal });
      })
      .then(
        result => {
          try {
            if (options) {
              applySuccessEffects(options, result, input, optimistic?.targets);
            }
            releaseOptimisticOwnership(optimistic);
            return result;
          } catch (error) {
            if (!optimistic) throw error;

            reconcileOptimisticState(optimistic);
            throw new GraphMutationReconciliationError(
              mutation.key,
              optimistic.snapshots.map(snapshot => snapshot.node.key),
              error,
            );
          }
        },
        error => {
          if (!optimistic) throw error;

          let failureKind: "rejected" | "unknown" = "unknown";
          try {
            if (options?.classifyFailure?.(error) === "rejected") {
              failureKind = "rejected";
            }
          } catch {
            // A classifier failure cannot prove remote rejection. Preserve the
            // safe unknown-outcome path and retain the remote error as cause.
          }

          if (failureKind === "rejected") {
            rollbackOptimistic(optimistic, error);
            throw error;
          }

          reconcileOptimisticState(optimistic);
          throw new GraphMutationOutcomeUnknownError(
            optimistic.targets.map(node => node.key),
            error,
          );
        },
      );
  };

  return Object.freeze({ mutate });
};
