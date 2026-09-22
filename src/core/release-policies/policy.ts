import type { ReleaseAfterOptions, ReleaseAfterPolicy, ReleasePolicy, RetainPolicy } from "./types";

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

/**
 * A `release` policy that frees a data node's value - resetting it to its
 * never-loaded shape - after it has had no subscribers, direct or
 * required, for the given duration. Use it for data that's expensive or
 * large but only needed while a specific view is open: a product's
 * details and reviews, freed a little while after the user navigates
 * away, so browsing a large catalog doesn't hold every product visited in
 * memory forever.
 *
 * @throws {@link RangeError} if `durationMs` isn't a finite number greater than 0.
 *
 * @example
 * ```ts
 * import { defineContextNode, defineDataNode, releaseAfter } from "vue-dependency-graph/core";
 *
 * const currentProductId = defineContextNode({ key: "currentProductId", initialValue: "prod-1" });
 *
 * const product = defineDataNode({
 *   key: "product",
 *   dependencies: [currentProductId] as const,
 *   initialValue: null,
 *   release: releaseAfter({ durationMs: 30_000 }),
 *   load: async ({ get }) => fetch(`/api/products/${get(currentProductId)}`).then((r) => r.json()),
 * });
 * ```
 *
 * @see {@link retain} to opt a node out of release entirely.
 * @see {@link GraphRuntimeOptions.releaseAfterMs} for setting a default
 * across every node that doesn't declare its own `release` policy.
 */
export const releaseAfter = (options: ReleaseAfterOptions): ReleaseAfterPolicy => {
  const value = requireObject(options, "releaseAfter options");
  return Object.freeze({
    kind: "release-after",
    durationMs: requirePositiveFinite(value.durationMs, "durationMs"),
  });
};

/**
 * A `release` policy that keeps a data node's value forever, regardless of
 * subscribers - overriding even a runtime-wide
 * {@link GraphRuntimeOptions.releaseAfterMs} default. Use it for state
 * that's cheap to hold and needed everywhere, where losing it between
 * views would be wrong rather than just wasteful: the cart, which should
 * still exist if the user navigates away and comes back later.
 *
 * @example
 * ```ts
 * import { defineDataNode, retain } from "vue-dependency-graph/core";
 *
 * const cart = defineDataNode({
 *   key: "cart",
 *   initialValue: { items: [] },
 *   release: retain(),
 *   load: async () => fetch("/api/cart").then((r) => r.json()),
 * });
 * ```
 *
 * @see {@link releaseAfter} for the opposite - freeing a node's value after an idle delay.
 */
export const retain = (): RetainPolicy => Object.freeze({ kind: "retain" });

export function assertValidReleasePolicy(
  policy: unknown,
  nodeKey: string,
): asserts policy is ReleasePolicy {
  const value = requireObject(policy, `Release policy for node "${nodeKey}"`);

  switch (value.kind) {
    case "release-after":
      releaseAfter(value as unknown as ReleaseAfterOptions);
      return;
    case "retain":
      return;
    default:
      throw new TypeError(`Release policy for node "${nodeKey}" has an unknown kind.`);
  }
}
