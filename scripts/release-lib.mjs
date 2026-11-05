// Pure helpers for the release workflow, kept separate from the CLI so they
// can be unit-tested (tests/tooling/release.spec.ts).

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** True for a valid semantic version such as `0.1.0` or `1.0.0-rc.1`. */
export const isSemver = (version) => typeof version === "string" && SEMVER.test(version);

/** Versions below 1.0.0, and any version with a prerelease tag, are pre-releases. */
export const isPrerelease = (version) => {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Not a semantic version: ${version}`);
  return match[1] === "0" || match[4] !== undefined;
};

/**
 * Returns the body of the `## [version] - YYYY-MM-DD` section of a Keep a
 * Changelog style file, or throws if the section is missing, has no date,
 * or is empty.
 */
export const extractChangelogSection = (changelog, version) => {
  const lines = changelog.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (heading === -1) {
    throw new Error(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section.`);
  }
  if (!/^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}\s*$/.test(lines[heading])) {
    throw new Error(
      `The CHANGELOG.md heading for ${version} must look like "## [${version}] - YYYY-MM-DD".`,
    );
  }
  const next = lines.findIndex((line, index) => index > heading && line.startsWith("## "));
  const body = lines
    .slice(heading + 1, next === -1 ? undefined : next)
    .join("\n")
    .trim();
  if (body.length === 0) {
    throw new Error(`The CHANGELOG.md section for ${version} is empty.`);
  }
  return body;
};

/**
 * Checks that a release tag, package.json and the changelog agree, and
 * returns what the workflow needs to publish the release.
 */
export const planRelease = ({ tag, packageJson, changelog }) => {
  const { name, version } = packageJson;
  if (!isSemver(version)) {
    throw new Error(`package.json version "${version}" is not a semantic version.`);
  }
  if (tag !== `v${version}`) {
    throw new Error(
      `Tag "${tag}" does not match package.json version "${version}" (expected "v${version}").`,
    );
  }
  return {
    name,
    version,
    prerelease: isPrerelease(version),
    notes: extractChangelogSection(changelog, version),
    tarball: `${name}-${version}.tgz`,
  };
};

/** The tarball must contain exactly what consumers need, and nothing else. */
export const REQUIRED_TARBALL_FILES = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/dist/core/index.js",
  "package/dist/core/index.d.ts",
  "package/dist/vue/index.js",
  "package/dist/vue/index.d.ts",
  "package/dist/devtools/index.js",
  "package/dist/devtools/index.d.ts",
  "package/dist/devtools/style.css",
];

const FORBIDDEN_TARBALL_PREFIXES = [
  "package/src/",
  "package/tests/",
  "package/docs/",
  "package/scripts/",
  "package/dist/playground/",
  "package/.github/",
];

/** Returns a list of problems with a tarball's file listing (empty means fine). */
export const inspectTarballListing = (files) => {
  const present = new Set(files);
  const problems = [];
  for (const required of REQUIRED_TARBALL_FILES) {
    if (!present.has(required)) problems.push(`missing ${required}`);
  }
  for (const file of files) {
    const forbidden = FORBIDDEN_TARBALL_PREFIXES.find((prefix) => file.startsWith(prefix));
    if (forbidden) problems.push(`unexpected ${file}`);
  }
  return problems;
};
