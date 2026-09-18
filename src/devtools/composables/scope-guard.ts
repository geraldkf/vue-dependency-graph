import { getCurrentScope } from "vue";

/**
 * Deliberately duplicated from `src/vue/scope-guard.ts` rather than
 * imported from it: that module is private to `src/vue` (not exported
 * from its public barrel), and reaching into another layer's internals to
 * avoid an 8-line, dependency-free duplicate is a worse trade than the
 * duplication itself. If this guard's logic ever needs to change, both
 * copies need the same change - there are exactly two, so that's a small
 * and easy thing to keep true, not a maintenance trap.
 */
export const assertActiveEffectScope = (composableName: string): void => {
  if (!getCurrentScope()) {
    throw new Error(
      `${composableName}() must be called inside setup() or an active effect scope, ` +
        "or its subscription will never be released."
    );
  }
};
