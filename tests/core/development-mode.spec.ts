import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevelopmentBuild } from "../../src/core/util/development-mode";

describe("isDevelopmentBuild", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is true outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevelopmentBuild()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(isDevelopmentBuild()).toBe(true);
  });

  it("is false in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevelopmentBuild()).toBe(false);
  });

  it("stays on, rather than throwing, where there is no `process` at all", () => {
    vi.stubGlobal("process", undefined);
    expect(isDevelopmentBuild()).toBe(true);
  });
});
