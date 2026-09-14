import type {
  AnyRefreshPolicy,
  ExponentialRetryOptions,
  ExponentialRetryPolicy,
  FixedRetryOptions,
  FixedRetryPolicy,
  PollUntilOptions,
  PollUntilPolicy,
  RefreshIntervalOptions,
  RefreshIntervalPolicy,
  RetryOptions,
  RetryPolicy,
  StaleAfterOptions,
  StaleAfterPolicy,
} from "./types";

const requireObject = (
  value: unknown,
  fieldName: string
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const requirePositiveFinite = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a finite number greater than 0.`);
  }
  return value;
};

const requireNonNegativeInteger = (
  value: unknown,
  fieldName: string
): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative integer.`);
  }
  return value;
};

const requireJitterRatio = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new RangeError("jitterRatio must be a finite number between 0 and 1.");
  }
  return value;
};

const normalizeFixedRetry = (
  options: FixedRetryOptions | Record<string, unknown>
): FixedRetryPolicy =>
  Object.freeze({
    strategy: "fixed",
    maxRetries: requireNonNegativeInteger(options.maxRetries, "maxRetries"),
    delayMs: requirePositiveFinite(options.delayMs, "delayMs"),
    jitterRatio: requireJitterRatio(options.jitterRatio ?? 0),
  });

const normalizeExponentialRetry = (
  options: ExponentialRetryOptions | Record<string, unknown>
): ExponentialRetryPolicy => {
  const initialDelayMs = requirePositiveFinite(
    options.initialDelayMs,
    "initialDelayMs"
  );
  const maxDelayMs = requirePositiveFinite(options.maxDelayMs, "maxDelayMs");
  if (maxDelayMs < initialDelayMs) {
    throw new RangeError(
      "maxDelayMs must be greater than or equal to initialDelayMs."
    );
  }
  const multiplier = options.multiplier ?? 2;
  if (
    typeof multiplier !== "number" ||
    !Number.isFinite(multiplier) ||
    multiplier < 1
  ) {
    throw new RangeError("multiplier must be a finite number greater than or equal to 1.");
  }

  return Object.freeze({
    strategy: "exponential",
    maxRetries: requireNonNegativeInteger(options.maxRetries, "maxRetries"),
    initialDelayMs,
    multiplier,
    maxDelayMs,
    jitterRatio: requireJitterRatio(options.jitterRatio ?? 0),
  });
};

const normalizeRetry = (value: unknown): RetryPolicy | undefined => {
  if (value === undefined) return undefined;
  const options = requireObject(value, "retry");
  if (options.strategy === "fixed") return normalizeFixedRetry(options);
  if (options.strategy === "exponential") {
    return normalizeExponentialRetry(options);
  }
  throw new TypeError('retry.strategy must be "fixed" or "exponential".');
};

export const staleAfter = (
  options: StaleAfterOptions
): StaleAfterPolicy => {
  const value = requireObject(options, "staleAfter options");
  return Object.freeze({
    kind: "stale-after",
    durationMs: requirePositiveFinite(value.durationMs, "durationMs"),
  });
};

export const refreshInterval = (
  options: RefreshIntervalOptions
): RefreshIntervalPolicy => {
  const value = requireObject(options, "refreshInterval options");
  return Object.freeze({
    kind: "interval",
    intervalMs: requirePositiveFinite(value.intervalMs, "intervalMs"),
    retry: normalizeRetry(value.retry),
  });
};

export const pollUntil = <TValue>(
  options: PollUntilOptions<TValue>
): PollUntilPolicy<TValue> => {
  const value = requireObject(options, "pollUntil options");
  if (typeof value.stopWhen !== "function") {
    throw new TypeError("stopWhen must be a function.");
  }
  if (value.failWhen !== undefined && typeof value.failWhen !== "function") {
    throw new TypeError("failWhen must be a function when provided.");
  }

  return Object.freeze({
    kind: "poll-until",
    intervalMs: requirePositiveFinite(value.intervalMs, "intervalMs"),
    timeoutMs: requirePositiveFinite(value.timeoutMs, "timeoutMs"),
    stopWhen: value.stopWhen as (value: TValue) => boolean,
    failWhen: value.failWhen as ((value: TValue) => boolean) | undefined,
    retry: normalizeRetry(value.retry),
  });
};

export function assertValidRefreshPolicy(
  policy: unknown,
  nodeKey: string
): asserts policy is AnyRefreshPolicy {
  const value = requireObject(policy, `Refresh policy for node "${nodeKey}"`);

  switch (value.kind) {
    case "stale-after":
      staleAfter(value as unknown as StaleAfterOptions);
      return;
    case "interval":
      refreshInterval(value as unknown as RefreshIntervalOptions);
      return;
    case "poll-until":
      pollUntil<unknown>(value as unknown as PollUntilOptions<unknown>);
      return;
    default:
      throw new TypeError(
        `Refresh policy for node "${nodeKey}" has an unknown kind.`
      );
  }
}
