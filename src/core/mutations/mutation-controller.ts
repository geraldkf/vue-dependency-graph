import type { EventMatchOptions } from "../events/event-matcher";
import type { AnyNodeDefinition } from "../graph/types";
import type { CombinedInvalidationPlan } from "../invalidation/invalidation";
import type { ActiveAttempt, NodeStateRecord } from "../state/state";
import type { EventPublication } from "../transactions/types";
import { GraphMutationConflictError } from "./errors";
import type { MutationDefinition, MutationOptions } from "./types";
import { createMutationUpdatePlanner } from "./mutation-update-planner";
import {
  createOptimisticSessionManager,
  type OptimisticSession,
} from "./optimistic-session";
import { createMutationCommitter } from "./mutation-commit";
import { createMutationSettlementCoordinator } from "./mutation-settlement";

type MutationLifecycleType =
  | "optimistic-committed"
  | "remote-started"
  | "remote-succeeded"
  | "remote-failed"
  | "success-committed";

type MutationLifecycleListener = (
  type: MutationLifecycleType,
  affectedNodeKeys?: readonly string[],
) => void;

export interface RuntimeMutationController {
  readonly mutate: <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    options?: MutationOptions<TInput, TResult>,
    onLifecycle?: MutationLifecycleListener,
  ) => Promise<TResult>;
}

export interface RuntimeMutationControllerDependencies {
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string,
  ) => AnyNodeDefinition;
  readonly getNodeState: (key: string) => NodeStateRecord;
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
 * Composes the internal mutation lifecycle and owns caller-driven remote
 * execution. Planning, session policy, graph commits, and settlement remain
 * private collaborators behind this single runtime-facing controller.
 */
export const createRuntimeMutationController = ({
  resolveRegisteredNode,
  getNodeState,
  getActiveAttempt,
  hasSubscribers,
  matchPublications,
  prepareCombinedInvalidation,
  notify,
  schedule,
}: RuntimeMutationControllerDependencies): RuntimeMutationController => {
  const updatePlanner = createMutationUpdatePlanner({
    resolveRegisteredNode,
    getNodeState,
  });

  const optimisticSessions = createOptimisticSessionManager({
    getNodeState,
    hasSubscribers,
  });

  const mutationCommitter = createMutationCommitter({
    getNodeState,
    getActiveAttempt,
    prepareCombinedInvalidation,
    releaseOptimisticSession: optimisticSessions.release,
    notify,
    schedule,
  });

  const mutationSettlement = createMutationSettlementCoordinator({
    resolveRegisteredNode,
    matchPublications,
    prepareCombinedInvalidation,
    updatePlanner,
    optimisticSessions,
    mutationCommitter,
  });

  /** Lifecycle seam: prepares and commits an effective optimistic session. */
  const startOptimisticSession = <TInput>(
    mutationKey: string,
    work: NonNullable<MutationOptions<TInput, unknown>["optimistic"]>,
    input: TInput,
    onLifecycle?: MutationLifecycleListener,
  ): OptimisticSession | undefined => {
    const prepared = updatePlanner.prepare(
      updatePlanner.collect(effects => work(effects, input), "optimistic"),
    );
    const changed = prepared.filter(update => update.changed);
    if (changed.length === 0) return undefined;

    const invalidation = prepareCombinedInvalidation(
      changed.map(({ node }) => node),
      [],
      changed.map(({ node }) => node),
    );
    const start = optimisticSessions.begin(
      changed.map(({ node }) => node),
      invalidation.affectedNodes,
    );
    if (!start.started) {
      throw new GraphMutationConflictError(start.conflictingKeys);
    }

    mutationCommitter.commitOptimistic(changed, invalidation);
    onLifecycle?.(
      "optimistic-committed",
      invalidation.affectedNodes.map((node) => node.key),
    );

    return optimisticSessions.captureExpectedGenerations(start.session);
  };

  /** Lifecycle seam: starts the caller-owned remote mutation attempt. */
  const executeRemoteMutation = <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    signal: AbortSignal,
  ): Promise<TResult> => mutation.execute({ input, signal });

  /** Lifecycle seam: reconciles a confirmed remote success. */
  const settleRemoteSuccess = <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    options: MutationOptions<TInput, TResult> | undefined,
    result: TResult,
    input: TInput,
    optimistic: OptimisticSession | undefined,
  ): TResult => mutationSettlement.settleSuccess(
    mutation.key,
    options,
    result,
    input,
    optimistic,
  );

  /** Lifecycle seam: classifies and reconciles a remote failure. */
  const settleRemoteFailure = <TInput, TResult>(
    options: MutationOptions<TInput, TResult> | undefined,
    error: unknown,
    optimistic: OptimisticSession | undefined,
  ): never => mutationSettlement.settleFailure(
    options,
    error,
    optimistic,
  );

  const mutate = <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    options?: MutationOptions<TInput, TResult>,
    onLifecycle?: MutationLifecycleListener,
  ): Promise<TResult> => {
    const controller = new AbortController();
    let optimistic: OptimisticSession | undefined;

    return Promise.resolve()
      .then(() => {
        if (options?.optimistic) {
          optimistic = startOptimisticSession(
            mutation.key,
            options.optimistic as NonNullable<
              MutationOptions<TInput, unknown>["optimistic"]
            >,
            input,
            onLifecycle,
          );
        }
        onLifecycle?.("remote-started");
        return executeRemoteMutation(mutation, input, controller.signal);
      })
      .then(
        result => {
          onLifecycle?.("remote-succeeded");
          const settled = settleRemoteSuccess(
            mutation,
            options,
            result,
            input,
            optimistic,
          );
          onLifecycle?.("success-committed");
          return settled;
        },
        error => {
          onLifecycle?.("remote-failed");
          return settleRemoteFailure(options, error, optimistic);
        },
      );
  };

  return Object.freeze({ mutate });
};
