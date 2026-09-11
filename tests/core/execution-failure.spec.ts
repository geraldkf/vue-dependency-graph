import { describe, expect, it } from "vitest";
import {
  GraphExecutionError,
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { deferred } from "./test-helpers";

describe("execution failures", () => {
  it("normalises initial and derived failures", async () => {
    const failed = defineDataNode({ key: "failed", initialValue: "", load: async () => { throw "failure"; } });
    const runtime = createGraphRuntime(createGraph({ nodes: [failed] }));

    await expect(runtime.execute([failed])).rejects.toBeInstanceOf(GraphExecutionError);
    expect(runtime.getState(failed)).toMatchObject({
      status: "error",
      freshness: "stale",
      hasSuccessfulValue: false,
    });
    expect(runtime.getState(failed).error?.message).toBe("failure");

    const base = defineContextNode({ key: "base", initialValue: 1 });
    const derived = defineDerivedNode({ key: "derived", dependencies: [base] as const, derive: () => { throw 42; } });
    const derivedRuntime = createGraphRuntime(createGraph({ nodes: [derived, base] }));
    await expect(derivedRuntime.execute([derived])).rejects.toBeInstanceOf(GraphExecutionError);
    expect(derivedRuntime.getState(derived).error?.message).toBe("42");
  });

  it("blocks dependent nodes while allowing independent branches to settle", async () => {
    const independentResult = deferred<string>();
    const failed = defineDataNode({ key: "failed", initialValue: "", load: async () => { throw new Error("failed"); } });
    const blocked = defineDerivedNode({ key: "blocked", dependencies: [failed] as const, derive: () => "never" });
    const independent = defineDataNode({ key: "independent", initialValue: "", load: () => independentResult.promise });
    const runtime = createGraphRuntime(createGraph({ nodes: [blocked, independent, failed] }));

    const execution = runtime.execute([blocked, independent]);
    await Promise.resolve();
    independentResult.resolve("complete");

    try {
      await execution;
      throw new Error("Expected execution failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphExecutionError);
      const failures = (error as GraphExecutionError).failures;
      expect(failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeKey: "failed", kind: "failed" }),
          expect.objectContaining({ nodeKey: "blocked", kind: "blocked", blockedBy: ["failed"] }),
        ])
      );
    }

    expect(runtime.getState(blocked).status).toBe("idle");
    expect(runtime.getState(independent)).toMatchObject({ data: "complete", status: "success" });
  });

  it("retains stale data after refresh failure and clears the error after recovery", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    let shouldFail = false;
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: "initial",
      load: async ({ get }) => {
        if (shouldFail) throw new Error("refresh failed");
        return `value-${get(context)}`;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    await runtime.execute([data]);
    shouldFail = true;
    runtime.setContext(context, 2);
    await expect(runtime.execute([data])).rejects.toBeInstanceOf(GraphExecutionError);
    expect(runtime.getState(data)).toMatchObject({
      data: "value-1",
      status: "error",
      freshness: "stale",
      hasSuccessfulValue: true,
    });

    shouldFail = false;
    await runtime.execute([data]);
    expect(runtime.getState(data)).toMatchObject({
      data: "value-2",
      status: "success",
      freshness: "fresh",
      error: null,
    });
  });
});
