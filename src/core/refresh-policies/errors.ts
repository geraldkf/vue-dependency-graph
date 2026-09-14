export class GraphPollingTimeoutError extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly timeoutMs: number
  ) {
    super(`Polling for node "${nodeKey}" timed out after ${timeoutMs}ms.`);
    this.name = "GraphPollingTimeoutError";
  }
}

export class GraphPollingConditionError extends Error {
  public constructor(
    public readonly nodeKey: string,
    message = `Polling for node "${nodeKey}" reached its failure condition.`,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GraphPollingConditionError";
  }
}

export class GraphRefreshRetryExhaustedError extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly attempts: number,
    public override readonly cause: Error
  ) {
    super(
      `Refresh policy for node "${nodeKey}" exhausted ${attempts} attempt(s).`,
      { cause }
    );
    this.name = "GraphRefreshRetryExhaustedError";
  }
}
