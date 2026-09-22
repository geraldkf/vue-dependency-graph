import { describe, expect, it } from "vitest";
import { createGraph, createGraphRuntime } from "../../src/core";

describe("graph runtime options", () => {
  it("preserves unlimited concurrency when options are omitted", () => {
    expect(() => createGraphRuntime(createGraph({ nodes: [] }))).not.toThrow();
    expect(() => createGraphRuntime(createGraph({ nodes: [] }), {})).not.toThrow();
  });

  it.each([0, -1, Number.NaN])(
    "rejects an invalid maxConcurrentLoads value of %s",
    (maxConcurrentLoads) => {
      expect(() =>
        createGraphRuntime(createGraph({ nodes: [] }), {
          maxConcurrentLoads,
        }),
      ).toThrow("maxConcurrent must be at least 1");
    },
  );
});
