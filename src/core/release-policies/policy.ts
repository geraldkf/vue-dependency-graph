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

export const releaseAfter = (options: ReleaseAfterOptions): ReleaseAfterPolicy => {
  const value = requireObject(options, "releaseAfter options");
  return Object.freeze({
    kind: "release-after",
    durationMs: requirePositiveFinite(value.durationMs, "durationMs"),
  });
};

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
