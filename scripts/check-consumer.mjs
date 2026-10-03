// Smoke-tests the *built* package the way consumers actually load it.
//
// The unit tests run against source under Vite, which hides a whole class of
// packaging bugs: a Vite-only `import.meta.env`, extensionless imports Node
// cannot resolve, `.vue` files that never made it into `dist`. This script
// loads `dist` through the package's own `exports` map in plain Node, and
// bundles it with esbuild - a bundler that does none of the things Vite does
// for you - then runs the result. Run it after `pnpm build`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` - ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const runNode = (args) =>
  execFileSync(process.execPath, args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

if (!existsSync(join(root, "dist", "core", "index.js"))) {
  console.error("dist/ is missing - run `pnpm build` first.");
  process.exit(1);
}

// 1. Every file the exports map promises is actually there.
for (const [subpath, target] of Object.entries(pkg.exports)) {
  const files = typeof target === "string" ? [target] : Object.values(target);
  for (const file of files) {
    check(`exports ${subpath} -> ${file} exists`, existsSync(join(root, file)));
  }
}

// 2. Shipped JavaScript carries nothing that only works under Vite, and does
//    not point at source files that were never emitted.
const shipped = ["core", "vue", "devtools", "chunks"]
  .map((dir) => join(root, "dist", dir))
  .filter(existsSync)
  .flatMap(walk)
  .filter((file) => file.endsWith(".js"));
const offenders = (pattern) =>
  shipped
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((f) => f.slice(root.length));
check(
  "no `import.meta.env` in shipped JS (it only exists under Vite)",
  offenders(/import\.meta\.env/).length === 0,
  offenders(/import\.meta\.env/).join(", "),
);
check(
  "no imports of .vue files in shipped JS (tsc cannot emit them)",
  offenders(/from\s+["'][^"']+\.vue["']/).length === 0,
  offenders(/from\s+["'][^"']+\.vue["']/).join(", "),
);
check(
  "core stays framework-free (never imports vue)",
  !/from\s+["']vue["']/.test(readFileSync(join(root, "dist", "core", "index.js"), "utf8")),
);

// 3. Each entry point loads in plain Node through the exports map, with the
//    expected API on it.
const expected = {
  core: ["createGraph", "createGraphRuntime", "defineDataNode", "GraphMutationError"],
  vue: ["useNode", "useNodes", "useQuery", "createGraphRuntimePlugin"],
  devtools: ["GraphDevtoolsPanel", "computeGraphView", "useGraphDevtools"],
};
for (const [entry, names] of Object.entries(expected)) {
  try {
    const loaded = runNode([
      "--input-type=module",
      "-e",
      `const m = await import("${pkg.name}/${entry}");
       console.log(${JSON.stringify(names)}.filter((name) => !(name in m)).join(","));`,
    ]);
    check(`native Node import of ${pkg.name}/${entry}`, loaded === "", `missing: ${loaded}`);
  } catch (error) {
    check(
      `native Node import of ${pkg.name}/${entry}`,
      false,
      String(error.stderr ?? error).split("\n")[0],
    );
  }
}

// 3b. The development-only guard against updaters that mutate in place must
//     be on outside production and off in production. This is behavioural on
//     purpose: Vite's library build quietly bakes `import.meta.env.DEV` to
//     `false`, which would ship a library whose dev guards are *never* on and
//     wouldn't crash or fail any import - only this catches it.
const guardProbe = `
  import { createGraph, createGraphRuntime, defineDataNode, defineMutation } from "${pkg.name}/core";
  const list = defineDataNode({ key: "list", initialValue: [], load: async () => [1, 2] });
  const save = defineMutation({ key: "save", execute: async () => undefined });
  const runtime = createGraphRuntime(createGraph({ nodes: [list] }));
  await runtime.execute([list]);
  try {
    await runtime.mutate(save, undefined, {
      onSuccess: (effects) => effects.update(list, (current) => { current.push(3); return current; }),
    });
    console.log("guard-off");
  } catch (error) {
    console.log("guard-on:" + error.name);
  }
`;
const probeWith = (nodeEnv) =>
  execFileSync(process.execPath, ["--input-type=module", "-e", guardProbe], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: nodeEnv },
  }).trim();
try {
  check(
    "in-place mutation guard is ON outside production",
    probeWith("development") === "guard-on:GraphMutationStateError",
  );
  check("in-place mutation guard is OFF in production", probeWith("production") === "guard-off");
} catch (error) {
  check("in-place mutation guard probe ran", false, String(error.stderr ?? error).split("\n")[0]);
}

// 4. A bundler that does not define `import.meta.env` (webpack, esbuild,
//    Rollup, Jest transforms...) can bundle `core` and run it, as ESM and CJS.
const scratch = mkdtempSync(join(tmpdir(), "vdg-consumer-"));
try {
  const corePath = join(root, "dist", "core", "index.js");
  const consumer = `
    import { createGraph, createGraphRuntime, defineContextNode, defineDerivedNode } from ${JSON.stringify(corePath)};
    const a = defineContextNode({ key: "a", initialValue: 2 });
    const doubled = defineDerivedNode({ key: "doubled", dependencies: [a], derive: ({ get }) => get(a) * 2 });
    const runtime = createGraphRuntime(createGraph({ nodes: [a, doubled] }));
    (async () => {
      await runtime.execute([doubled]);
      console.log("doubled=" + runtime.getState(doubled).data);
    })();
  `;
  for (const format of ["esm", "cjs"]) {
    const outfile = join(scratch, `consumer.${format}.${format === "esm" ? "mjs" : "cjs"}`);
    try {
      await build({
        stdin: { contents: consumer, resolveDir: root, sourcefile: "consumer.js" },
        bundle: true,
        platform: "node",
        format,
        outfile,
        logLevel: "silent",
      });
      check(`bundled with esbuild as ${format} and ran`, runNode([outfile]) === "doubled=4");
    } catch (error) {
      check(
        `bundled with esbuild as ${format} and ran`,
        false,
        String(error.errors?.[0]?.text ?? error.stderr ?? error.message).split("\n")[0],
      );
    }
  }

  // The component entry points must at least bundle: this is what fails when
  // a `.vue` import or a missing file slips into `dist`.
  for (const entry of ["vue", "devtools"]) {
    try {
      await build({
        entryPoints: [join(root, "dist", entry, "index.js")],
        bundle: true,
        write: false,
        platform: "browser",
        format: "esm",
        external: ["vue"],
        logLevel: "silent",
      });
      check(`${entry} entry bundles cleanly`, true);
    } catch (error) {
      check(`${entry} entry bundles cleanly`, false, String(error.errors?.[0]?.text ?? error));
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} consumer check(s) failed.`);
  process.exit(1);
}
console.log("\nConsumer checks passed.");
