import { inject, type InjectionKey, type Plugin } from "vue";
import type { GraphRuntime } from "../core";

/**
 * Not exported from `src/vue/index.ts`. If it were public, a consumer could
 * call `inject(GraphRuntimeKey)` directly and silently receive `undefined`
 * on a miss, bypassing the explicit error `useGraphRuntime` throws instead.
 * Tests that need to provide a runtime without a full plugin import this
 * key directly from this module, not through the public barrel.
 */
export const GraphRuntimeKey: InjectionKey<GraphRuntime> = Symbol("graph-runtime");

export interface GraphRuntimePluginOptions {
  /**
   * Whether the runtime is disposed (`runtime.dispose()`) when the app that
   * installed the plugin is unmounted. Defaults to `true`: installing the
   * plugin makes the app the runtime's owner, so its background policy
   * timers stop with it.
   *
   * Pass `false` when the runtime outlives this app or is owned elsewhere -
   * for example shared between several apps, or created by a Pinia store
   * that disposes it itself. Disposal is idempotent, so a runtime that ends
   * up disposed twice is harmless; an owner that disposes a runtime other
   * code still relies on is the case to avoid.
   */
  readonly disposeOnUnmount?: boolean;
}

/**
 * Installs a `GraphRuntime` for injection by `useGraphRuntime` (and, later,
 * `useNode`/`useNodes`) anywhere in the component tree below, and - unless
 * `options.disposeOnUnmount` is `false` - disposes it when the app unmounts.
 */
export const createGraphRuntimePlugin = (
  runtime: GraphRuntime,
  options?: GraphRuntimePluginOptions,
): Plugin => ({
  install(app) {
    app.provide(GraphRuntimeKey, runtime);
    if (options?.disposeOnUnmount ?? true) {
      app.onUnmount(() => runtime.dispose());
    }
  },
});

/**
 * Resolves the `GraphRuntime` installed by `createGraphRuntimePlugin`.
 * Throws immediately if none was installed, rather than returning
 * `undefined` and failing confusingly at the first call that uses it.
 */
export const useGraphRuntime = (): GraphRuntime => {
  const runtime = inject(GraphRuntimeKey);
  if (!runtime) {
    throw new Error(
      "No GraphRuntime found. Install it with app.use(createGraphRuntimePlugin(runtime)).",
    );
  }
  return runtime;
};
