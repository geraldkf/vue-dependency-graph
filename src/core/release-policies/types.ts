/**
 * The internal shape a data node's `release` option (a plain number of
 * milliseconds, or `Infinity`) normalizes to. Not part of the public
 * surface - `release` is authored as a number, never constructed as this
 * object directly.
 */
export interface ReleaseAfterPolicy {
  readonly kind: "release-after";
  readonly durationMs: number;
}

/** The `Infinity` (never release) case of the normalized shape above. */
export interface RetainPolicy {
  readonly kind: "retain";
}

/**
 * The internal, normalized form of a data node's `release` option -
 * {@link ReleaseAfterPolicy} for a finite duration, {@link RetainPolicy}
 * for `Infinity`. Not part of the public surface.
 */
export type ReleasePolicy = ReleaseAfterPolicy | RetainPolicy;
