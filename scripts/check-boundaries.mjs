import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const coreDirectory = fileURLToPath(new URL("../src/core/", import.meta.url));
const forbiddenImports = [
  /from\s+["']vue["']/,
  /from\s+["']pinia["']/,
  /from\s+["']\.\.\/vue(?:\/|["'])/,
  /from\s+["']\.\.\/devtools(?:\/|["'])/,
  /from\s+["']\.\.\/playground(?:\/|["'])/,
];

const inspectDirectory = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspectDirectory(path);
      continue;
    }
    if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
    const source = await readFile(path, "utf8");
    if (forbiddenImports.some(pattern => pattern.test(source))) {
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
    if (forbiddenDiagnosticCapabilityImports.some(pattern => pattern.test(source))) {
      throw new Error(`Forbidden diagnostics implementation import found in ${filePath}`);
    }
  }
}
console.log("Diagnostic capability boundary check passed.");
