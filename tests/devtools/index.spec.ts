import { describe, expect, it } from "vitest";
import { devtoolsLayerName } from "../../src/devtools";

describe("devtools public entry point", () => {
  it("can consume the public core layer", () => {
    expect(devtoolsLayerName).toBe("devtools:core");
  });
});
