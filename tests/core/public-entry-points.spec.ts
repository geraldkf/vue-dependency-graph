import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as core from "../../src/core";
import * as devtools from "../../src/devtools";
import * as vue from "../../src/vue";

describe("public entry points", () => {
  it("exposes only explicit package subpaths", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports).toEqual({
      "./core": expect.any(Object),
      "./vue": expect.any(Object),
      "./devtools": expect.any(Object),
    });
    expect(Object.hasOwn(packageJson.exports, ".")).toBe(false);
  });

  it("keeps internal core utilities and layer markers private", () => {
    expect(core).not.toHaveProperty("coreLayerName");
    expect(core).not.toHaveProperty("isAbortError");
    expect(core).not.toHaveProperty("toError");
    expect(core).toHaveProperty("createDefaultTimerEnvironment");
  });

  it("keeps the Vue layer marker private", () => {
    expect(vue).not.toHaveProperty("vueLayerName");
    expect(vue).toHaveProperty("useGraphRuntime");
  });

  it("supports one public panel while retaining composables and protocol transforms", () => {
    expect(devtools).not.toHaveProperty("devtoolsLayerName");
    expect(devtools).not.toHaveProperty("GraphView");
    expect(devtools).not.toHaveProperty("NodeInspector");
    expect(devtools).not.toHaveProperty("Timeline");
    expect(devtools).not.toHaveProperty("MetricsPanel");
    expect(devtools).toHaveProperty("GraphDevtoolsPanel");
    expect(devtools).toHaveProperty("useGraphDevtools");
    expect(devtools).toHaveProperty("computeGraphView");
  });
});
