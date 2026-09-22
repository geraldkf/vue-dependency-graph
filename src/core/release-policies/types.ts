/** Options for {@link releaseAfter}. */
export interface ReleaseAfterOptions {
  /**
   * How long a node may sit with no subscribers - direct or required -
   * before its value is released (reset to its never-loaded shape).
   */
  readonly durationMs: number;
}

/** The policy returned by {@link releaseAfter}. */
export interface ReleaseAfterPolicy {
  readonly kind: "release-after";
  readonly durationMs: number;
}

/** The policy returned by {@link retain}. */
export interface RetainPolicy {
  readonly kind: "retain";
}

/**
 * The type of a data node's `release` option: {@link ReleaseAfterPolicy}
 * or {@link RetainPolicy}, produced by {@link releaseAfter} and
 * {@link retain} respectively.
 */
export type ReleasePolicy = ReleaseAfterPolicy | RetainPolicy;
