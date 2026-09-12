import { inject, type InjectionKey, type Plugin } from "vue";
import type { GraphRuntime } from "../core";

/**
 * Not exported from `src/vue/index.ts`. If it were public, a consumer could
 * call `inject(GraphRuntimeKey)` directly and silently receive `undefined`
 * on a miss, bypassing the explicit error `useGraphRuntime` throws instead.
 * Tests that need to provide a runtime without a full plugin import this
 * key directly from this module, not through the public barrel.
 */
export const GraphRuntimeKey: InjectionKey<GraphRuntime> = Symbol(
  "graph-runtime"
);

/**
 * Installs a `GraphRuntime` for injection by `useGraphRuntime` (and, later,
 * `useNode`/`useNodes`) anywhere in the component tree below.
 */
export const createGraphRuntimePlugin = (runtime: GraphRuntime): Plugin => ({
  install(app) {
    app.provide(GraphRuntimeKey, runtime);
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
      "No GraphRuntime found. Install it with app.use(createGraphRuntimePlugin(runtime))."
    );
  }
  return runtime;
};
