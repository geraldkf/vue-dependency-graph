import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectBoundaries } from "./boundary-rules.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
let inspected = 0;
const inspect = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else if ([".ts", ".tsx", ".vue"].includes(extname(file))) {
      inspected += 1;
      for (const issue of inspectBoundaries(await readFile(file, "utf8"), file, root))
        failures.push(relative(root, file) + ": " + issue);
    }
  }
};
await inspect(join(root, "src"));
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  "Parsed import and state boundaries passed (" + inspected + " files across all layers).",
);
