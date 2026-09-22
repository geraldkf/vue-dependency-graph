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
  RetryPolicy,
  StaleAfterOptions,
  StaleAfterPolicy,
} from "./types";

const requireObject = (value: unknown, fieldName: string): Record<string, unknown> => {
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

const requireNonNegativeInteger = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative integer.`);
  }
  return value;
};

const requireJitterRatio = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("jitterRatio must be a finite number between 0 and 1.");
  }
  return value;
};

const normalizeFixedRetry = (
  options: FixedRetryOptions | Record<string, unknown>,
): FixedRetryPolicy =>
  Object.freeze({
    strategy: "fixed",
    maxRetries: requireNonNegativeInteger(options.maxRetries, "maxRetries"),
    delayMs: requirePositiveFinite(options.delayMs, "delayMs"),
    jitterRatio: requireJitterRatio(options.jitterRatio ?? 0),
  });

const normalizeExponentialRetry = (
  options: ExponentialRetryOptions | Record<string, unknown>,
): ExponentialRetryPolicy => {
  const initialDelayMs = requirePositiveFinite(options.initialDelayMs, "initialDelayMs");
  const maxDelayMs = requirePositiveFinite(options.maxDelayMs, "maxDelayMs");
  if (maxDelayMs < initialDelayMs) {
    throw new RangeError("maxDelayMs must be greater than or equal to initialDelayMs.");
  }
  const multiplier = options.multiplier ?? 2;
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier < 1) {
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

/**
 * A `refresh` policy that marks a data node's value stale after a fixed
 * duration, rather than refetching on a timer. The value isn't touched
 * when it goes stale - the next read triggers the refetch. Good for data
 * that changes occasionally and doesn't need to update in the background:
 * a product's name and description, say, where refetching only matters if
 * someone's actually looking at the page again.
 *
 * @throws {@link RangeError} if `durationMs` isn't a finite number greater than 0.
 *
 * @example
 * ```ts
 * import { defineContextNode, defineDataNode, staleAfter } from "vue-dependency-graph/core";
 *
 * const currentProductId = defineContextNode({ key: "currentProductId", initialValue: "prod-1" });
 *
 * const product = defineDataNode({
 *   key: "product",
 *   dependencies: [currentProductId] as const,
 *   initialValue: null,
 *   refresh: staleAfter({ durationMs: 5 * 60 * 1000 }), // 5 minutes
 *   load: async ({ get }) => fetch(`/api/products/${get(currentProductId)}`).then((r) => r.json()),
 * });
 * ```
 *
 * @see {@link refreshInterval} to refetch proactively on a timer instead
 * of waiting for the next read.
 */
export const staleAfter = (options: StaleAfterOptions): StaleAfterPolicy => {
  const value = requireObject(options, "staleAfter options");
  return Object.freeze({
    kind: "stale-after",
    durationMs: requirePositiveFinite(value.durationMs, "durationMs"),
  });
};

/**
 * A `refresh` policy that refetches a data node on a fixed timer for as
 * long as it has subscribers - a background poll rather than a lazy
 * refetch-on-read. Good as a backstop for data that's supposed to update
 * via an event but might occasionally miss one: stock levels, kept fresh
 * every 10 seconds while a product page is open even if a `stock-changed`
 * event gets dropped.
 *
 * @throws {@link RangeError} if `intervalMs` isn't a finite number greater than 0.
 *
 * @example
 * ```ts
 * import { defineContextNode, defineDataNode, refreshInterval } from "vue-dependency-graph/core";
 *
 * const currentProductId = defineContextNode({ key: "currentProductId", initialValue: "prod-1" });
 *
 * const inventory = defineDataNode({
 *   key: "inventory",
 *   dependencies: [currentProductId] as const,
 *   initialValue: null,
 *   refresh: refreshInterval({
 *     intervalMs: 10_000,
 *     retry: { strategy: "fixed", maxRetries: 3, delayMs: 1000 },
 *   }),
 *   load: async ({ get }) => fetch(`/api/inventory/${get(currentProductId)}`).then((r) => r.json()),
 * });
 * ```
 *
 * @see {@link pollUntil} to poll only until a specific condition is met,
 * rather than indefinitely.
 * @see {@link defineDataNode}'s `invalidatedBy` option for refetching on
 * an explicit event instead of - or alongside - a timer.
 */
export const refreshInterval = (options: RefreshIntervalOptions): RefreshIntervalPolicy => {
  const value = requireObject(options, "refreshInterval options");
  return Object.freeze({
    kind: "interval",
    intervalMs: requirePositiveFinite(value.intervalMs, "intervalMs"),
    retry: normalizeRetry(value.retry),
  });
};

/**
 * A `refresh` policy that refetches on a timer until `stopWhen` returns
 * `true`, then stops. The canonical use is watching an operation through
 * to completion: an order's status after checkout, polled every few
 * seconds until it reaches `"shipped"`.
 *
 * Polling ends one of three ways: `stopWhen` returns `true` (success -
 * the node settles on that value), `failWhen` returns `true` (the node
 * rejects with {@link GraphPollingConditionError} - e.g. the order was
 * cancelled), or `timeoutMs` elapses first (the node rejects with
 * {@link GraphPollingTimeoutError}).
 *
 * @throws {@link RangeError} if `intervalMs` or `timeoutMs` isn't a finite
 * number greater than 0. `TypeError` if `stopWhen` isn't a function, or
 * `failWhen` is provided and isn't a function.
 *
 * @example
 * ```ts
 * import { defineContextNode, defineDataNode, pollUntil } from "vue-dependency-graph/core";
 *
 * interface Order {
 *   readonly status: "pending" | "confirmed" | "shipped" | "cancelled";
 * }
 *
 * const currentOrderId = defineContextNode({ key: "currentOrderId", initialValue: "" });
 *
 * const order = defineDataNode({
 *   key: "order",
 *   dependencies: [currentOrderId] as const,
 *   initialValue: null as Order | null,
 *   refresh: pollUntil<Order | null>({
 *     intervalMs: 3000,
 *     timeoutMs: 60_000,
 *     stopWhen: (value) => value?.status === "shipped",
 *     failWhen: (value) => value?.status === "cancelled",
 *   }),
 *   load: async ({ get }) => fetch(`/api/orders/${get(currentOrderId)}`).then((r) => r.json()),
 * });
 * ```
 *
 * @see {@link refreshInterval} to poll indefinitely instead of until a condition.
 */
export const pollUntil = <TValue>(options: PollUntilOptions<TValue>): PollUntilPolicy<TValue> => {
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
  nodeKey: string,
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
      throw new TypeError(`Refresh policy for node "${nodeKey}" has an unknown kind.`);
  }
}
