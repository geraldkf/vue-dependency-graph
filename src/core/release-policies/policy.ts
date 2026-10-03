import { requireObject, requirePositiveFinite } from "../util/validation";
import type { ReleaseAfterPolicy, ReleasePolicy } from "./types";

/**
 * Normalizes a data node's public `release` option - a plain number of
 * milliseconds, or `Infinity` to opt out of release entirely, overriding
 * even a runtime-wide `releaseAfterMs` default - into the internal policy
 * shape the release controller reads. Not exported: `release` is authored
 * as a number; nothing outside this module constructs a `ReleasePolicy`
 * directly.
 *
 * @throws {@link RangeError} if `release` isn't `Infinity` and isn't a
 * finite number greater than 0.
 */
export const normalizeReleaseOption = (release: number, nodeKey: string): ReleasePolicy => {
  if (release === Infinity) return Object.freeze({ kind: "retain" });
  const durationMs = requirePositiveFinite(release, `Release duration for node "${nodeKey}"`);
  return Object.freeze({ kind: "release-after", durationMs });
};

export function assertValidReleasePolicy(
  policy: unknown,
  nodeKey: string,
): asserts policy is ReleasePolicy {
  const value = requireObject(policy, `Release policy for node "${nodeKey}"`);

  switch (value.kind) {
    case "release-after":
      requirePositiveFinite(
        (value as unknown as ReleaseAfterPolicy).durationMs,
        `Release duration for node "${nodeKey}"`,
      );
      return;
    case "retain":
      return;
    default:
      throw new TypeError(`Release policy for node "${nodeKey}" has an unknown kind.`);
  }
}
