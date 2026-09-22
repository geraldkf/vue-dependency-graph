import { computed, onScopeDispose, shallowRef, type ComputedRef } from "vue";
import type { AnyNodeDefinition, NodeRuntimeState, RuntimeNodeData } from "../core";
import { resolveGraphRuntime, type GraphComposableOptions } from "./composable-options";
import { assertActiveEffectScope } from "./scope-guard";
import { statesEqual } from "./states-equal";

export interface UseNodesAggregate {
  readonly isLoading: ComputedRef<boolean>; // any node loading or refreshing
  readonly isError: ComputedRef<boolean>; // any node has a non-null error
  readonly errors: ComputedRef<readonly Error[]>; // all non-null errors, in node order
  readonly isSuccess: ComputedRef<boolean>; // every node has a successful value
}

export type UseNodesResults<TNodes extends readonly AnyNodeDefinition[]> = {
  readonly [K in keyof TNodes]: ComputedRef<NodeRuntimeState<RuntimeNodeData<TNodes[K]>>>;
};

export interface UseNodesResult<
  TNodes extends readonly AnyNodeDefinition[],
> extends UseNodesAggregate {
  readonly results: UseNodesResults<TNodes>;
}

/**
 * Subscribes to several nodes for the lifetime of the calling effect
 * scope with a single combined subscription and a single `onChange`
 * listener — not `createNodeSubscription` called once per node, which
 * would mean N independent subscriptions and N listeners for what is
 * conceptually one query. `statesEqual` (V3A) is still reused, per node,
 * inside that single listener.
 *
 * `results[K]` preserves each node's own specific data type via a `const`
 * type parameter, the same mechanism `defineDataNode`'s `dependencies`
 * already uses — callers don't need to write `useNodes([a, b] as const)`.
 */
export const useNodes = <const TNodes extends readonly AnyNodeDefinition[]>(
  nodes: TNodes,
  options?: GraphComposableOptions,
): UseNodesResult<TNodes> => {
  assertActiveEffectScope("useNodes");
  const runtime = resolveGraphRuntime(options);

  const state = shallowRef(nodes.map((node) => runtime.getState(node)));

  const sync = (): void => {
    const next = nodes.map((node) => runtime.getState(node));
    const changed = next.some((nextState, index) => {
      const previousState = state.value[index];
      return previousState === undefined || !statesEqual(previousState, nextState);
    });
    if (changed) {
      state.value = next;
    }
  };

  const subscription = runtime.subscribeNodes(nodes);
  const stopWatching = runtime.onChange(sync);

  onScopeDispose(() => {
    stopWatching();
    subscription.unsubscribe();
  });

  const results = nodes.map((_, index) =>
    computed(() => state.value[index]),
  ) as unknown as UseNodesResults<TNodes>;

  return {
    results,
    isLoading: computed(() =>
      state.value.some(
        (nodeState) => nodeState.status === "loading" || nodeState.status === "refreshing",
      ),
    ),
    isError: computed(() => state.value.some((nodeState) => nodeState.error !== null)),
    errors: computed(() =>
      state.value
        .map((nodeState) => nodeState.error)
        .filter((error): error is Error => error !== null),
    ),
    isSuccess: computed(() => state.value.every((nodeState) => nodeState.hasSuccessfulValue)),
  };
};
