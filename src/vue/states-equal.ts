import type { NodeRuntimeState } from "../core";

/**
 * Field-by-field comparison used to decide whether a `useNode`/`useNodes`
 * internal ref actually needs to change after a global `onChange`
 * notification.
 *
 * The core's `getSnapshot` allocates a new object on every call regardless
 * of whether anything changed, and `onChange` is a single global signal
 * with no indication of which node changed. Without this comparison, every
 * mounted composable would re-render on every unrelated state change
 * anywhere in the graph — see
 * `docs/implementation/25-vue-adapter-and-playground-plan.md` for the
 * empirical basis for this.
 *
 * `generation` is deliberately excluded: it changes on every invalidation
 * even when `data`/`status`/`error` end up identical (for example, a
 * context change that re-runs a derived node to the same result), and
 * comparing it would defeat the whole point of this check.
 */
export const statesEqual = (a: NodeRuntimeState<unknown>, b: NodeRuntimeState<unknown>): boolean =>
  a.data === b.data &&
  a.status === b.status &&
  a.freshness === b.freshness &&
  a.error === b.error &&
  a.hasSuccessfulValue === b.hasSuccessfulValue;
