import { describe, expect, it, vi } from "vitest";
import {
  GraphValidationError,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("node definitions", () => {
  it("defines immutable context, data, and derived descriptors without executing functions", () => {
    const context = defineContextNode({ key: "count", initialValue: 2 });
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({
      key: "label",
      dependencies: [context] as const,
      initialValue: "initial",
      load,
    });
    const derive = vi.fn(() => "derived");
    const derived = defineDerivedNode({
      key: "summary",
      dependencies: [context, data] as const,
      derive,
    });

    expect(context).toMatchObject({ key: "count", kind: "context", initialValue: 2 });
    expect(data).toMatchObject({ key: "label", kind: "data", initialValue: "initial" });
    expect(derived).toMatchObject({ key: "summary", kind: "derived" });
    expect(data.dependencies).toEqual([context]);
    expect(derived.dependencies).toEqual([context, data]);
    expect(load).not.toHaveBeenCalled();
    expect(derive).not.toHaveBeenCalled();
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.dependencies)).toBe(true);
  });

  it.each(["", "   ", "\t\n"])("rejects blank key %j", key => {
    expect(() => defineContextNode({ key, initialValue: 0 })).toThrowError(
      expect.objectContaining<Partial<GraphValidationError>>({
        code: "INVALID_NODE_KEY",
      })
    );
  });
});
