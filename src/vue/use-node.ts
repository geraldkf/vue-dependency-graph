import { computed, onScopeDispose, type ComputedRef } from "vue";
import type { AnyNodeDefinition, NodeFreshness, NodeStatus, RuntimeNodeData } from "../core";
import { resolveGraphRuntime, type GraphComposableOptions } from "./composable-options";
import { assertActiveEffectScope } from "./scope-guard";
import { createNodeSubscription } from "./node-subscription";

export interface UseNodeResult<TNode extends AnyNodeDefinition> {
  readonly data: ComputedRef<RuntimeNodeData<TNode>>;
  readonly status: ComputedRef<NodeStatus>;
  readonly freshness: ComputedRef<NodeFreshness>;
  readonly error: ComputedRef<Error | null>;
  readonly hasSuccessfulValue: ComputedRef<boolean>;
}

/**
 * Subscribes to a single node for the lifetime of the calling effect
 * scope (normally: the component it's called from), keeping its returned
 * refs in sync with the node's state and releasing the subscription
 * automatically on scope disposal.
 *
 * Returns individual `computed()` refs rather than one nested state ref
 * so `const { data, status } = useNode(userNode)` stays reactive after
 * destructuring — see `docs/implementation/25-vue-adapter-and-playground-plan.md`
 * for the reasoning.
 */
export const useNode = <TNode extends AnyNodeDefinition>(
  node: TNode,
  options?: GraphComposableOptions,
): UseNodeResult<TNode> => {
  assertActiveEffectScope("useNode");
  const runtime = resolveGraphRuntime(options);

  const { state, dispose } = createNodeSubscription(runtime, node);

  onScopeDispose(dispose);

  return {
    data: computed(() => state.value.data),
    status: computed(() => state.value.status),
    freshness: computed(() => state.value.freshness),
    error: computed(() => state.value.error),
    hasSuccessfulValue: computed(() => state.value.hasSuccessfulValue),
  };
};
