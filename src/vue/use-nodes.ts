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
 * scope with a single combined subscription — not `createNodeSubscription`
 * called once per node, which would mean N independent subscriptions for
 * what is conceptually one query. Each node gets its own `onNodeChange`
 * listener, so a notification only re-reads the nodes that actually
 * changed. `statesEqual` (V3A) is still reused, per node, inside each
 * listener.
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

  const syncNode = (index: number): void => {
    const node = nodes[index];
    if (node === undefined) return;
    const next = runtime.getState(node);
    const previousState = state.value[index];
    if (previousState !== undefined && statesEqual(previousState, next)) return;
    const updated = [...state.value];
    updated[index] = next;
    state.value = updated;
  };

  const subscription = runtime.subscribeNodes(nodes);
  const stopWatching = nodes.map((node, index) =>
    runtime.onNodeChange(node, () => syncNode(index)),
  );
  // A node listener only hears about changes made after it registered, so
  // catch up on anything that changed since `state` was first read.
  nodes.forEach((_, index) => syncNode(index));

  onScopeDispose(() => {
    for (const stop of stopWatching) stop();
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
