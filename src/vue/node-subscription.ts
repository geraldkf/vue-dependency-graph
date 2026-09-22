import { shallowRef, type ShallowRef } from "vue";
import type { AnyNodeDefinition, GraphRuntime, NodeRuntimeState, RuntimeNodeData } from "../core";
import { statesEqual } from "./states-equal";

export interface NodeSubscription<TNode extends AnyNodeDefinition> {
  readonly state: ShallowRef<NodeRuntimeState<RuntimeNodeData<TNode>>>;
  readonly dispose: () => void;
}

/**
 * Subscribes to a single node and keeps `state` in sync with it via the
 * runtime's global `onChange` signal, only actually replacing the ref's
 * value when `statesEqual` says something the composable reads has
 * changed — see `states-equal.ts` for why that comparison exists at all.
 *
 * Deliberately does not check for an active effect scope and does not
 * register its own `onScopeDispose` cleanup — that's the calling
 * composable's responsibility (see `useNode`, and later `useNodes`), so
 * this primitive makes no assumption that one subscription always maps
 * to exactly one Vue effect scope's dispose hook.
 *
 * `subscription.unsubscribe()` and the `onChange` unsubscribe function
 * are both verified idempotent directly against
 * `subscriptions/subscriptions.ts` and `observation/observer.ts` — each
 * guards itself with its own `active` flag — so calling `dispose()` more
 * than once is safe.
 */
export const createNodeSubscription = <TNode extends AnyNodeDefinition>(
  runtime: GraphRuntime,
  node: TNode,
): NodeSubscription<TNode> => {
  const state = shallowRef(runtime.getState(node));

  const sync = (): void => {
    const next = runtime.getState(node);
    if (!statesEqual(state.value, next)) {
      state.value = next;
    }
  };

  const subscription = runtime.subscribeNodes([node]);
  const stopWatching = runtime.onChange(sync);

  const dispose = (): void => {
    stopWatching();
    subscription.unsubscribe();
  };

  return { state, dispose };
};
