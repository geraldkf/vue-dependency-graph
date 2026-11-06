import type { NodeRuntimeState } from "../core";

/**
 * Field-by-field comparison used to decide whether a `useNode`/`useNodes`
 * internal ref actually needs to change after its node's `onNodeChange`
 * notification.
 *
 * The core's `getSnapshot` allocates a new object on every call regardless
 * of whether anything changed, and a node notification fires when *any*
 * field changed - including `generation`, which the composables do not
 * read. Without this comparison, a composable would re-render on state
 * changes it cannot observe - see
 * `docs/architecture/07-vue-and-pinia-integration.md` for the
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
