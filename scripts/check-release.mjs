// Release gate used by .github/workflows/release.yml, runnable locally.
//
//   node scripts/check-release.mjs plan --tag v0.1.0 --notes release-notes.md
//     Verifies the tag, package.json and CHANGELOG.md agree, writes the
//     release notes, and prints `tarball=` and `prerelease=` lines (also
//     appended to $GITHUB_OUTPUT when set).
//
//   node scripts/check-release.mjs tarball vue-dependency-graph-0.1.0.tgz
//     Verifies a packed tarball contains the built entry points, README and
//     LICENSE and nothing that should not ship (src, tests, docs, playground).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspectTarballListing, planRelease } from "./release-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const option = (args, name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const fail = (message) => {
  console.error(`release check failed: ${message}`);
  process.exit(1);
};

const [command, ...args] = process.argv.slice(2);

if (command === "plan") {
  const tag = option(args, "--tag");
  const notesPath = option(args, "--notes");
  if (!tag || !notesPath) fail("usage: plan --tag <tag> --notes <file>");
  let plan;
  try {
    plan = planRelease({
      tag,
      packageJson: JSON.parse(read("package.json")),
      changelog: read("CHANGELOG.md"),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  writeFileSync(notesPath, `${plan.notes}\n`);
  const lines = [`tarball=${plan.tarball}`, `prerelease=${plan.prerelease}`];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
} else if (command === "tarball") {
  const file = args[0];
  if (!file) fail("usage: tarball <file.tgz>");
  const listing = execFileSync("tar", ["-tzf", file], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const problems = inspectTarballListing(listing);
  if (problems.length > 0) fail(`tarball problems:\n  ${problems.join("\n  ")}`);
  console.log(`ok   ${file} contains the expected files (${listing.length} total)`);
} else {
  fail("usage: check-release.mjs plan --tag <tag> --notes <file> | tarball <file.tgz>");
}
