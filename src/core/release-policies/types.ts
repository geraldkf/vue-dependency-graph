export interface ReleaseAfterOptions {
  readonly durationMs: number;
}

export interface ReleaseAfterPolicy {
  readonly kind: "release-after";
  readonly durationMs: number;
}

export interface RetainPolicy {
  readonly kind: "retain";
}

export type ReleasePolicy = ReleaseAfterPolicy | RetainPolicy;
