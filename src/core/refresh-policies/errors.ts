/**
 * Rejects a node using {@link pollUntil} when `timeoutMs` elapses before
 * `stopWhen` ever returns `true` - e.g. an order that never reaches
 * `"shipped"` within the allotted 60 seconds. The node's last fetched
 * value is preserved on its state; only the poll itself fails.
 */
export class GraphPollingTimeoutError extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly timeoutMs: number,
  ) {
    super(`Polling for node "${nodeKey}" timed out after ${timeoutMs}ms.`);
    this.name = "GraphPollingTimeoutError";
  }
}

/**
 * Rejects a node using {@link pollUntil} when its `failWhen` predicate
 * returns `true` - e.g. an order's status becoming `"cancelled"`. Distinct
 * from a timeout: this means the outcome is now known to be a failure,
 * not that the node simply ran out of time to find out.
 */
export class GraphPollingConditionError extends Error {
  public constructor(
    public readonly nodeKey: string,
    message = `Polling for node "${nodeKey}" reached its failure condition.`,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GraphPollingConditionError";
  }
}

/**
 * Rejects a node using {@link refreshInterval} or {@link pollUntil} when
 * its `retry` option is set and every retry attempt has also failed. The
 * node keeps its last successful value; `cause` holds the final attempt's
 * underlying error.
 */
export class GraphRefreshRetryExhaustedError extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly attempts: number,
    public override readonly cause: Error,
  ) {
    super(`Refresh policy for node "${nodeKey}" exhausted ${attempts} attempt(s).`, { cause });
    this.name = "GraphRefreshRetryExhaustedError";
  }
}
