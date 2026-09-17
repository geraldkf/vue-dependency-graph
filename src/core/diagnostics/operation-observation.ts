export type GraphChangeObservationReason =
  | "context-invalidation"
  | "changed-result";

export interface OperationObservation {
  readonly operationId: string;
  readonly reason: GraphChangeObservationReason;
}

/**
 * Some runtime operations (context writes, transaction commits,
 * changed-result invalidation) need the *current* operation id and reason
 * to be visible to callbacks several layers down (e.g. invalidation's
 * `onContextsCommitted`), without threading it through every function
 * signature in between. This tracker replaces the previous save/restore
 * pattern duplicated across `setContext`, `commitGraphChanges`, and the
 * execution controller's `onChangedRefreshResult` wiring with one
 * reusable, correctly-nesting primitive.
 */
export interface OperationObservationTracker {
  /** The innermost currently-running observed operation, if any. */
  readonly current: () => OperationObservation | undefined;
  /**
   * Runs `fn` with `observation` as the current operation, restoring the
   * previous observation (if any) afterwards - including on throw.
   */
  readonly runObserved: <T>(
    observation: OperationObservation,
    fn: () => T,
  ) => T;
}

export const createOperationObservationTracker =
  (): OperationObservationTracker => {
    let active: OperationObservation | undefined;

    return Object.freeze({
      current: () => active,
      runObserved: <T>(observation: OperationObservation, fn: () => T): T => {
        const previous = active;
        active = observation;
        try {
          return fn();
        } finally {
          active = previous;
        }
      },
    });
  };
