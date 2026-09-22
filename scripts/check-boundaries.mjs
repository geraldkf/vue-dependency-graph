import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const coreDirectory = fileURLToPath(new URL("../src/core/", import.meta.url));
const forbiddenImports = [
  /from\s+["']vue["']/,
  /from\s+["']pinia["']/,
  /from\s+["']\.\.\/vue(?:\/|["'])/,
  /from\s+["']\.\.\/devtools(?:\/|["'])/,
  /from\s+["']\.\.\/playground(?:\/|["'])/,
];

const inspectDirectory = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspectDirectory(path);
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
    const source = await readFile(path, "utf8");
    if (forbiddenImports.some((pattern) => pattern.test(source))) {
      throw new Error(`Forbidden core import found in ${path}`);
    }
  }
};

await inspectDirectory(coreDirectory);
console.log("Core boundary check passed.");

const capabilityDirectories = [
  "events",
  "execution",
  "invalidation",
  "mutations",
  "observation",
  "operations",
  "queries",
  "refresh-policies",
  "scheduling",
  "state",
  "subscriptions",
  "transactions",
];
const forbiddenDiagnosticCapabilityImports = [
  /diagnostics\/in-memory-diagnostics/,
  /diagnostics\/metrics/,
  /diagnostics\/snapshot-normaliser/,
];

for (const directory of capabilityDirectories) {
  const path = join(coreDirectory, directory);
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name))) {
      continue;
    }
    const filePath = join(path, entry.name);
    const source = await readFile(filePath, "utf8");
    if (forbiddenDiagnosticCapabilityImports.some((pattern) => pattern.test(source))) {
      throw new Error(`Forbidden diagnostics implementation import found in ${filePath}`);
    }
  }
}
console.log("Diagnostic capability boundary check passed.");

// State write boundary.
//
// A node's runtime state record is read-only everywhere except
// `state/transitions.ts`, which holds the one writable view of it. Two textual
// checks keep the compiler's guarantee from being bypassed:
//
// 1. No writable mapped type (`-readonly`) anywhere else in `src/core`, which
//    is how a second writable view would be created.
// 2. Only the modules below may import the transitions, so "who may change
//    node state" is a reviewed list rather than whoever happens to import it.
//    Adding a module here is a deliberate architectural decision: say why.
const stateTransitionsFile = join(coreDirectory, "state", "transitions.ts");
const allowedTransitionImporters = new Set([
  "composition/policy-services.ts", // failAttempt: a refresh policy failed
  "execution/execution.ts", // begin/succeed/fail/abort attempt lifecycle
  "invalidation/invalidation.ts", // invalidate, and context writes (writeValue)
  "mutations/mutation-commit.ts", // writeValue and restoreSnapshot
  "operations/operations.ts", // invalidate for refresh
  "release-policies/policy-controller.ts", // releaseValue
]);
const writableMappedType = /-\s*readonly\b/;
const transitionsImport = /from\s+["'](?:[^"']*\/state\/transitions|\.\/transitions)["']/;

const listSourceFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(path)));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
};

for (const filePath of await listSourceFiles(coreDirectory)) {
  if (filePath === stateTransitionsFile) continue;
  const source = await readFile(filePath, "utf8");
  const relativePath = relative(coreDirectory, filePath).split(sep).join("/");
  if (writableMappedType.test(source)) {
    throw new Error(
      `Writable mapped type (-readonly) found in ${relativePath}. Node state is made writable only inside state/transitions.ts; add or extend a transition instead.`,
    );
  }
  if (transitionsImport.test(source) && !allowedTransitionImporters.has(relativePath)) {
    throw new Error(
      `${relativePath} imports state/transitions but is not on the allowlist in scripts/check-boundaries.mjs. Only modules that own a state transition may change node state.`,
    );
  }
}
console.log("State write boundary check passed.");
