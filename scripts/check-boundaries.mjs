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
