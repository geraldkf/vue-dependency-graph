import { describe, expect, it } from "vitest";
import { vueLayerName } from "../../src/vue";

describe("Vue public entry point", () => {
  it("can consume the public core layer", () => {
    expect(vueLayerName).toBe("vue:core");
  });
});
