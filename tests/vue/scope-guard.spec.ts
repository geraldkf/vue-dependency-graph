import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { render } from "@testing-library/vue";
import { assertActiveEffectScope } from "../../src/vue/scope-guard";

describe("assertActiveEffectScope", () => {
  it("throws when called with no active effect scope", () => {
    expect(() => assertActiveEffectScope("useNode")).toThrow(
      /useNode\(\) must be called inside setup\(\)/
    );
  });

  it("does not throw when called from inside a mounted component's setup()", () => {
    let threw = false;

    const Probe = defineComponent({
      setup() {
        try {
          assertActiveEffectScope("useNode");
        } catch {
          threw = true;
        }
        return () => null;
      },
    });

    render(Probe);

    expect(threw).toBe(false);
  });
});
