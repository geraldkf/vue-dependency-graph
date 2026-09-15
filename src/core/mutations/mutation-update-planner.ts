import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DependencyList,
  EventInvalidationList,
} from "../graph/types";
import type { MutableNodeRuntimeState } from "../state/state";
import { GraphMutationStateError } from "./errors";
import type { MutationUpdateEffects } from "./types";
import {
  guardMutationUpdaterValue,
  isMutationValueMutationError,
} from "./mutation-value-guard";

export interface MutationUpdateDraft {
  readonly node: AnyNodeDefinition;
  readonly updater: (current: unknown) => unknown;
}

export interface PreparedMutationUpdate {
  readonly node: AnyNodeDefinition;
  readonly state: MutableNodeRuntimeState;
  readonly value: unknown;
  readonly changed: boolean;
}

export interface MutationUpdatePlanner {
  readonly collect: (
    work: (effects: MutationUpdateEffects) => void,
    operation: "optimistic" | "success",
  ) => readonly MutationUpdateDraft[];
  readonly prepare: (
    drafts: readonly MutationUpdateDraft[],
  ) => readonly PreparedMutationUpdate[];
}

export interface MutationUpdatePlannerDependencies {
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string,
  ) => AnyNodeDefinition;
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

export const createMutationUpdatePlanner = ({
  resolveRegisteredNode,
  getMutableState,
}: MutationUpdatePlannerDependencies): MutationUpdatePlanner => {
  const collect = (
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

  const prepare = (
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
      return Object.freeze({
        node,
        state,
        value,
        changed:
          !Object.is(state.data, value) ||
          state.status !== "success" ||
          state.freshness !== "fresh" ||
          state.error !== null,
      });
    });
  };

  return Object.freeze({ collect, prepare });
};
