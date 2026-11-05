export function isSemver(version: unknown): boolean;
export function isPrerelease(version: string): boolean;
export function extractChangelogSection(changelog: string, version: string): string;
export function planRelease(input: {
  tag: string;
  packageJson: { name: string; version: string };
  changelog: string;
}): {
  name: string;
  version: string;
  prerelease: boolean;
  notes: string;
  tarball: string;
};
export const REQUIRED_TARBALL_FILES: readonly string[];
export function inspectTarballListing(files: readonly string[]): string[];
