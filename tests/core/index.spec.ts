import { describe, expect, it } from "vitest";
import { coreLayerName } from "../../src/core";

describe("core public entry point", () => {
  it("exposes the core layer placeholder", () => {
    expect(coreLayerName).toBe("core");
  });
});
