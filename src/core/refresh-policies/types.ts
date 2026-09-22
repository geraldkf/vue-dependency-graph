/** Options for {@link staleAfter}. */
export interface StaleAfterOptions {
  /**
   * How long a successfully loaded value stays fresh. Once this elapses,
   * the value isn't cleared or refetched automatically - it's simply
   * marked stale, and the next read (e.g. a component using
   * {@link useNode} mounting, or an explicit {@link GraphRuntime.execute})
   * triggers a refetch.
   */
  readonly durationMs: number;
}

/** Options for a fixed-delay `retry` on {@link RefreshIntervalOptions} or {@link PollUntilOptions}. */
export interface FixedRetryOptions {
  readonly strategy: "fixed";
  /** How many times to retry after the first failed attempt. */
  readonly maxRetries: number;
  /** Delay before each retry, in milliseconds. */
  readonly delayMs: number;
  /**
   * Randomizes each delay by up to this fraction (0 to 1) to avoid many
   * clients retrying in lockstep. Defaults to `0` (no jitter).
   */
  readonly jitterRatio?: number;
}

/** Options for an exponential-backoff `retry` on {@link RefreshIntervalOptions} or {@link PollUntilOptions}. */
export interface ExponentialRetryOptions {
  readonly strategy: "exponential";
  /** How many times to retry after the first failed attempt. */
  readonly maxRetries: number;
  /** Delay before the first retry, in milliseconds. */
  readonly initialDelayMs: number;
  /** Factor each subsequent delay is multiplied by. Defaults to `2`. */
  readonly multiplier?: number;
  /** Upper bound on any single retry delay, in milliseconds. */
  readonly maxDelayMs: number;
  /**
   * Randomizes each delay by up to this fraction (0 to 1) to avoid many
   * clients retrying in lockstep. Defaults to `0` (no jitter).
   */
  readonly jitterRatio?: number;
}

/** A retry policy for {@link RefreshIntervalOptions} or {@link PollUntilOptions}: {@link FixedRetryOptions} or {@link ExponentialRetryOptions}. */
export type RetryOptions = FixedRetryOptions | ExponentialRetryOptions;

/** Options for {@link refreshInterval}. */
export interface RefreshIntervalOptions {
  /** How often to refetch, in milliseconds, for as long as the node has subscribers. */
  readonly intervalMs: number;
  /**
   * Retries a failed refetch before the next scheduled interval, instead
   * of leaving the node in an error state until then. Exhausting the
   * retries rejects with {@link GraphRefreshRetryExhaustedError}; the node
   * keeps its last successful value in the meantime.
   */
  readonly retry?: RetryOptions;
}

/** Options for {@link pollUntil}. */
export interface PollUntilOptions<TValue> {
  /** How often to refetch while polling, in milliseconds. */
  readonly intervalMs: number;
  /**
   * How long to poll in total before giving up, in milliseconds.
   * Exceeded, the node rejects with {@link GraphPollingTimeoutError}.
   */
  readonly timeoutMs: number;
  /**
   * Called with each fetched value; returning `true` stops polling and
   * leaves the node on that value (e.g. an order reaching `"shipped"`).
   */
  readonly stopWhen: (value: TValue) => boolean;
  /**
   * Called with each fetched value; returning `true` stops polling and
   * rejects with {@link GraphPollingConditionError} instead of settling
   * (e.g. an order reaching `"cancelled"`). Omitted, polling only ever
   * stops via `stopWhen` or `timeoutMs`.
   */
  readonly failWhen?: (value: TValue) => boolean;
  /**
   * Retries a failed poll attempt before the next scheduled interval.
   * Exhausting the retries rejects with
   * {@link GraphRefreshRetryExhaustedError}.
   */
  readonly retry?: RetryOptions;
}

/** The policy returned by {@link staleAfter}. */
export interface StaleAfterPolicy {
  readonly kind: "stale-after";
  readonly durationMs: number;
}

/** The policy variant returned when `retry.strategy` is `"fixed"`. */
export interface FixedRetryPolicy {
  readonly strategy: "fixed";
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly jitterRatio: number;
}

/** The policy variant returned when `retry.strategy` is `"exponential"`. */
export interface ExponentialRetryPolicy {
  readonly strategy: "exponential";
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly multiplier: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

/** A normalized retry policy: {@link FixedRetryPolicy} or {@link ExponentialRetryPolicy}. */
export type RetryPolicy = FixedRetryPolicy | ExponentialRetryPolicy;
/** Which retry strategy a {@link RetryPolicy} uses. */
export type RetryStrategy = RetryPolicy["strategy"];

/** The policy returned by {@link refreshInterval}. */
export interface RefreshIntervalPolicy {
  readonly kind: "interval";
  readonly intervalMs: number;
  readonly retry: RetryPolicy | undefined;
}

/** The policy returned by {@link pollUntil}. */
export interface PollUntilPolicy<TValue> {
  readonly kind: "poll-until";
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly stopWhen: (value: TValue) => boolean;
  readonly failWhen: ((value: TValue) => boolean) | undefined;
  readonly retry: RetryPolicy | undefined;
  /** Carries TValue for inference without storing runtime state. */
  readonly __valueType?: TValue;
}

/**
 * The type of a data node's `refresh` option: {@link StaleAfterPolicy},
 * {@link RefreshIntervalPolicy}, or {@link PollUntilPolicy}, produced by
 * {@link staleAfter}, {@link refreshInterval}, and {@link pollUntil}
 * respectively.
 */
export type RefreshPolicy<TValue> =
  StaleAfterPolicy | RefreshIntervalPolicy | PollUntilPolicy<TValue>;

/** A {@link RefreshPolicy} for any value type - used for parameters that accept any refresh policy. */
export type AnyRefreshPolicy = RefreshPolicy<unknown>;
