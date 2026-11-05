import { describe, expect, it } from "vitest";
import {
  REQUIRED_TARBALL_FILES,
  extractChangelogSection,
  inspectTarballListing,
  isPrerelease,
  isSemver,
  planRelease,
} from "../../scripts/release-lib.mjs";

const changelog = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-12-01

### Added

- Second thing.

## [0.1.0] - 2026-11-04

### Added

- First thing.

### Changed (breaking)

- Nothing yet.
`;

describe("release versions", () => {
  it.each(["0.1.0", "1.0.0", "1.2.3-rc.1", "10.20.30+build.5"])("accepts %s", (version) => {
    expect(isSemver(version)).toBe(true);
  });

  it.each(["1", "1.0", "v1.0.0", "01.0.0", "1.0.0-", "", "latest"])("rejects %s", (version) => {
    expect(isSemver(version)).toBe(false);
  });

  it("marks 0.x and tagged versions as pre-releases, and stable 1.x+ as releases", () => {
    expect(isPrerelease("0.1.0")).toBe(true);
    expect(isPrerelease("1.0.0-rc.1")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(isPrerelease("2.3.4")).toBe(false);
  });
});

describe("changelog extraction", () => {
  it("returns only the requested version's section", () => {
    const section = extractChangelogSection(changelog, "0.1.0");
    expect(section).toContain("First thing.");
    expect(section).toContain("Changed (breaking)");
    expect(section).not.toContain("Second thing.");
  });

  it("stops at the next version heading", () => {
    const section = extractChangelogSection(changelog, "0.2.0");
    expect(section).toContain("Second thing.");
    expect(section).not.toContain("First thing.");
  });

  it("rejects a missing version", () => {
    expect(() => extractChangelogSection(changelog, "0.3.0")).toThrow(/no "## \[0\.3\.0\]/);
  });

  it("rejects a heading without a date", () => {
    expect(() => extractChangelogSection("## [0.1.0]\n\n- thing\n", "0.1.0")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects an empty section", () => {
    expect(() =>
      extractChangelogSection("## [0.1.0] - 2026-11-04\n\n## [0.0.1] - 2026-01-01\n- x\n", "0.1.0"),
    ).toThrow(/empty/);
  });
});

describe("release planning", () => {
  const packageJson = { name: "vue-dependency-graph", version: "0.1.0" };

  it("plans a matching tag, version and changelog", () => {
    expect(planRelease({ tag: "v0.1.0", packageJson, changelog })).toMatchObject({
      version: "0.1.0",
      prerelease: true,
      tarball: "vue-dependency-graph-0.1.0.tgz",
    });
  });

  it("refuses a tag that disagrees with package.json", () => {
    expect(() => planRelease({ tag: "v0.2.0", packageJson, changelog })).toThrow(/does not match/);
    expect(() => planRelease({ tag: "0.1.0", packageJson, changelog })).toThrow(/does not match/);
  });

  it("refuses a package.json version without a changelog entry", () => {
    expect(() =>
      planRelease({ tag: "v0.9.0", packageJson: { ...packageJson, version: "0.9.0" }, changelog }),
    ).toThrow(/CHANGELOG\.md has no/);
  });

  it("refuses an invalid package.json version", () => {
    expect(() =>
      planRelease({
        tag: "vlatest",
        packageJson: { ...packageJson, version: "latest" },
        changelog,
      }),
    ).toThrow(/not a semantic version/);
  });
});

describe("tarball inspection", () => {
  it("accepts exactly the required files", () => {
    expect(inspectTarballListing([...REQUIRED_TARBALL_FILES])).toEqual([]);
  });

  it("reports a missing entry point", () => {
    const files = REQUIRED_TARBALL_FILES.filter((file) => file !== "package/dist/vue/index.js");
    expect(inspectTarballListing(files)).toEqual(["missing package/dist/vue/index.js"]);
  });

  it("reports files that must not ship", () => {
    const problems = inspectTarballListing([
      ...REQUIRED_TARBALL_FILES,
      "package/src/core/index.ts",
      "package/dist/playground/index.html",
      "package/tests/setup.ts",
    ]);
    expect(problems).toEqual([
      "unexpected package/src/core/index.ts",
      "unexpected package/dist/playground/index.html",
      "unexpected package/tests/setup.ts",
    ]);
  });
});
