import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { inspectBoundaries } from "../../scripts/boundary-rules.mjs";

const root = process.cwd();
describe("parsed architectural boundaries", () => {
  it.each([
    "import { x } from '../../vue';",
    "export * from '../../devtools';",
    "void import('vue');",
    "type X = import('pinia').Store;",
    "require('@/playground/main');",
  ])("rejects forbidden core reference: %s", (source) => {
    expect(
      inspectBoundaries(source, resolve(root, "src/core/nested/example.ts"), root).length,
    ).toBeGreaterThan(0);
  });
  it("does not mistake comments and strings for imports", () => {
    expect(
      inspectBoundaries(
        "// import x from 'vue';\nconst text = `from 'pinia' -readonly`;",
        resolve(root, "src/core/example.ts"),
        root,
      ),
    ).toEqual([]);
  });
  it("requires public cross-layer imports in Vue files", () => {
    expect(
      inspectBoundaries(
        '<script setup lang="ts">import { x } from "../../core/state/state";</script>',
        resolve(root, "src/devtools/components/Example.vue"),
        root,
      )[0],
    ).toMatch(/public entry point/);
    expect(
      inspectBoundaries('import { x } from "../core";', resolve(root, "src/vue/example.ts"), root),
    ).toEqual([]);
  });
  it("enforces transition ownership and writable mapped types", () => {
    expect(
      inspectBoundaries(
        'import { x } from "./state/transitions"; type Writable<T> = { -readonly [K in keyof T]: T[K] };',
        resolve(root, "src/core/example.ts"),
        root,
      ),
    ).toHaveLength(2);
  });
  it("includes release policies in diagnostics boundaries", () => {
    expect(
      inspectBoundaries(
        'import { x } from "../diagnostics/metrics";',
        resolve(root, "src/core/release-policies/example.ts"),
        root,
      )[0],
    ).toMatch(/diagnostics implementation/);
  });
});
