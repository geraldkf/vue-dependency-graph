import type { NodeStateRecord } from "./state";
import type { NodeFreshness } from "./types";

/**
 * Every write to a node's runtime state goes through one of the functions in
 * this module. Each one is a named, complete transition: it sets *all* the
 * fields that must change together, so no caller can leave a node in a state
 * the fields do not describe (for example a `success` status that still
 * carries an error).
 *
 * Transitions only change the state object. They never notify, schedule,
 * abort, or emit diagnostics - callers own that sequencing, which differs per
 * site - and they never check preconditions such as generations; callers do
 * that before they transition.
 *
 * ## The generation rule
 *
 * `generation` counts how many times a node's state has been superseded. It
 * is what stale in-flight work is compared against, so:
 *
 * - transitions that supersede in-flight work bump it: `invalidate`,
 *   `writeValue`, `restoreSnapshot`, `releaseValue`;
 * - transitions that are the attempt lifecycle itself never bump it:
 *   `beginAttempt`, `succeedAttempt`, `failAttempt`, `abortAttempt` - they
 *   are what the generation check guards.
 *
 * ## Enforcement
 *
 * The state record's fields are `readonly` everywhere else, so assigning one
 * outside this module is a compile error. This module holds the only
 * writable view (`writable`, below); `scripts/check-boundaries.mjs` fails the
 * build if a writable mapped type appears anywhere else in `src/core`, and
 * only an allowlisted set of modules may import this file. The tests pin the
 * behaviour: `tests/core/state-transitions.spec.ts` (each transition),
 * `tests/core/runtime-state-trace.spec.ts` (the states a node moves through),
 * and `tests/core/state-types.test.ts` (the compile-time rule itself).
 */

/** The one place the readonly state record is made writable. Not exported. */
type WritableState = { -readonly [K in keyof NodeStateRecord]: NodeStateRecord[K] };
const writable = (state: NodeStateRecord): WritableState => state as WritableState;

/** The fields a snapshot restores; `generation` is never restored. */
export type NodeStateFields = Pick<
  NodeStateRecord,
  "data" | "status" | "freshness" | "error" | "hasSuccessfulValue"
>;

/**
 * The node's value is out of date and anything still running for it is
 * superseded. Keeps the value; goes back to `success` if there is one, else
 * `idle`. Clears any error, because the failure it described no longer
 * applies to the superseded state.
 */
export const invalidate = (state: NodeStateRecord): void => {
  const target = writable(state);
  target.generation += 1;
  target.freshness = "stale";
  target.status = state.hasSuccessfulValue ? "success" : "idle";
  target.error = null;
};

/**
 * An execution attempt starts: `refreshing` if the node already has a
 * successful value (which stays visible), else `loading`.
 */
export const beginAttempt = (state: NodeStateRecord): void => {
  const target = writable(state);
  target.status = state.hasSuccessfulValue ? "refreshing" : "loading";
  target.freshness = "stale";
  target.error = null;
};

/** An execution attempt produced `value`. */
export const succeedAttempt = (state: NodeStateRecord, value: unknown): void => {
  const target = writable(state);
  target.data = value;
  target.status = "success";
  target.freshness = "fresh";
  target.error = null;
  target.hasSuccessfulValue = true;
};

/**
 * An execution attempt ended without a result and nothing superseded the
 * node while it ran (it was aborted, for example because the last subscriber
 * left, or it was cancelled while queued): the node is no longer running.
 * Keeps any value and drops the `loading`/`refreshing` status the attempt set;
 * stale, because the attempt never produced the fresh value it started for.
 *
 * Only for an attempt that still owns the node's state. An attempt that was
 * superseded (generation changed, or a newer attempt took over) must leave
 * the superseding transition's state alone.
 */
export const abortAttempt = (state: NodeStateRecord): void => {
  const target = writable(state);
  target.status = state.hasSuccessfulValue ? "success" : "idle";
  target.freshness = "stale";
  target.error = null;
};

/**
 * An execution attempt (or a policy acting on the node) failed. Keeps the
 * last successful value and its flag, so the node can still be shown while it
 * is in error.
 */
export const failAttempt = (state: NodeStateRecord, error: Error): void => {
  const target = writable(state);
  target.status = "error";
  target.freshness = "stale";
  target.error = error;
};

/**
 * A value is written directly, not loaded: a context write, or a mutation's
 * optimistic or success update. `freshness` is `stale` when the same
 * mutation also invalidates something this value depends on.
 *
 * Marks the node as having a successful value. That is already true in every
 * reachable case - contexts start with one, and the mutation planner rejects
 * an update to a node without one before anything is written - so it is a
 * no-op there, and it keeps the transition complete on its own.
 */
export const writeValue = (
  state: NodeStateRecord,
  value: unknown,
  freshness: NodeFreshness,
): void => {
  const target = writable(state);
  target.data = value;
  target.status = "success";
  target.freshness = freshness;
  target.error = null;
  target.generation += 1;
  target.hasSuccessfulValue = true;
};

/**
 * Puts back what a mutation's optimistic update replaced. The restore is
 * itself a supersession, so it bumps the generation rather than rewinding it.
 */
export const restoreSnapshot = (state: NodeStateRecord, snapshot: NodeStateFields): void => {
  const target = writable(state);
  target.data = snapshot.data;
  target.status = snapshot.status;
  target.freshness = snapshot.freshness;
  target.error = snapshot.error;
  target.hasSuccessfulValue = snapshot.hasSuccessfulValue;
  target.generation += 1;
};

/**
 * An idle value is dropped: back to the node's never-loaded shape, with the
 * node's `initialValue` and no successful value.
 */
export const releaseValue = (state: NodeStateRecord, initialValue: unknown): void => {
  const target = writable(state);
  target.data = initialValue;
  target.hasSuccessfulValue = false;
  target.status = "idle";
  target.freshness = "stale";
  target.error = null;
  target.generation += 1;
};
