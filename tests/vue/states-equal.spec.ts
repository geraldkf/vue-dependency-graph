import { describe, expect, it } from "vitest";
import type { NodeRuntimeState } from "../../src/core";
import { statesEqual } from "../../src/vue/states-equal";

const baseState: NodeRuntimeState<number> = {
  data: 1,
  status: "success",
  freshness: "fresh",
  error: null,
  generation: 1,
  hasSuccessfulValue: true,
};

describe("statesEqual", () => {
  it("returns true for identical states", () => {
    expect(statesEqual(baseState, { ...baseState })).toBe(true);
  });

  it("returns true when only generation differs", () => {
    // The whole point of excluding generation: a state that only differs
    // by generation must still compare equal, or the dirty-check never
    // filters anything out.
    expect(statesEqual(baseState, { ...baseState, generation: 2 })).toBe(true);
  });

  it("returns false when data differs", () => {
    expect(statesEqual(baseState, { ...baseState, data: 2 })).toBe(false);
  });

  it("returns false when status differs", () => {
    expect(statesEqual(baseState, { ...baseState, status: "loading" })).toBe(false);
  });

  it("returns false when freshness differs", () => {
    expect(statesEqual(baseState, { ...baseState, freshness: "stale" })).toBe(false);
  });

  it("returns false when error differs", () => {
    expect(statesEqual(baseState, { ...baseState, error: new Error("boom") })).toBe(false);
  });

  it("returns false when hasSuccessfulValue differs", () => {
    expect(statesEqual(baseState, { ...baseState, hasSuccessfulValue: false })).toBe(false);
  });
});
