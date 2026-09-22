export interface StaleAfterOptions {
  readonly durationMs: number;
}

export interface FixedRetryOptions {
  readonly strategy: "fixed";
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly jitterRatio?: number;
}

export interface ExponentialRetryOptions {
  readonly strategy: "exponential";
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly multiplier?: number;
  readonly maxDelayMs: number;
  readonly jitterRatio?: number;
}

export type RetryOptions = FixedRetryOptions | ExponentialRetryOptions;

export interface RefreshIntervalOptions {
  readonly intervalMs: number;
  readonly retry?: RetryOptions;
}

export interface PollUntilOptions<TValue> {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly stopWhen: (value: TValue) => boolean;
  readonly failWhen?: (value: TValue) => boolean;
  readonly retry?: RetryOptions;
}

export interface StaleAfterPolicy {
  readonly kind: "stale-after";
  readonly durationMs: number;
}

export interface FixedRetryPolicy {
  readonly strategy: "fixed";
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly jitterRatio: number;
}

export interface ExponentialRetryPolicy {
  readonly strategy: "exponential";
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly multiplier: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export type RetryPolicy = FixedRetryPolicy | ExponentialRetryPolicy;
export type RetryStrategy = RetryPolicy["strategy"];

export interface RefreshIntervalPolicy {
  readonly kind: "interval";
  readonly intervalMs: number;
  readonly retry: RetryPolicy | undefined;
}

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

export type RefreshPolicy<TValue> =
  StaleAfterPolicy | RefreshIntervalPolicy | PollUntilPolicy<TValue>;

export type AnyRefreshPolicy = RefreshPolicy<unknown>;
