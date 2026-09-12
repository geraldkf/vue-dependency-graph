import { getCurrentScope } from "vue";

/**
 * `useNode`/`useNodes` must run inside an active Vue effect scope
 * (normally: inside `setup()`, or inside another composable called from
 * `setup()`) so `onScopeDispose` actually fires and releases the
 * subscription. Calling either outside a scope would silently leak the
 * subscription forever — `onScopeDispose` is a no-op with no active scope
 * and gives no warning. This guard throws a clear error instead of
 * allowing that silent leak.
 *
 * Not exported from `src/vue/index.ts` — nothing has asked for consumers
 * to write their own wrapping composables yet. Export it later if that
 * need actually shows up.
 */
export const assertActiveEffectScope = (composableName: string): void => {
  if (!getCurrentScope()) {
    throw new Error(
      `${composableName}() must be called inside setup() or an active effect scope, ` +
        "or its subscription will never be released."
    );
  }
};
