import { describe, expect, it, vi } from "vitest";
import {
  GraphExecutionError,
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

/**
 * These tests lock in behaviour that is easy to lose when execution.ts's
 * exception-based control flow (ObsoleteAttempt / NodeBlockedFailure /
 * NodeAttemptFailure thrown across a recursive async graph walk) is
 * refactored into an explicit Result type. In particular:
 *
 * - `ActiveAttempt.promise` is shared runtime state: a second, unrelated
 *   `runtime.execute(...)` call can be handed the exact same promise a
 *   first call is already awaiting (see executeNode's reuse branch). Both
 *   callers must observe the same outcome, whether it's success, failure,
 *   or the attempt being superseded mid-flight.
 * - A node made obsolete (superseded by a newer generation) must resolve
 *   its caller's `execute()` cleanly rather than surfacing as a failure -
 *   only genuine node failures/blocks belong in a GraphExecutionError.
 * - A diamond ancestor's failure must block every sibling that depends on
 *   it, not just one, while only loading the shared ancestor once.
 */
describe("execution: diamond fan-out and shared-attempt outcomes", () => {
  it("blocks every sibling that shares a failing ancestor, loading it once", async () => {
    const load = vi.fn(async () => {
      throw new Error("parent failed");
    });
    const parent = defineDataNode({ key: "parent", initialValue: 0, load });
    const left = defineDerivedNode({
      key: "left",
      dependencies: [parent] as const,
      derive: () => "left-never",
    });
    const right = defineDerivedNode({
      key: "right",
      dependencies: [parent] as const,
      derive: () => "right-never",
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [left, right, parent] }),
    );

    try {
      await runtime.execute([left, right]);
      throw new Error("Expected execution failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphExecutionError);
      const failures = (error as GraphExecutionError).failures;
      expect(failures).toHaveLength(3);
      expect(failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeKey: "parent", kind: "failed" }),
          expect.objectContaining({
            nodeKey: "left",
            kind: "blocked",
            blockedBy: ["parent"],
          }),
          expect.objectContaining({
            nodeKey: "right",
            kind: "blocked",
            blockedBy: ["parent"],
          }),
        ]),
      );
    }

    expect(load).toHaveBeenCalledOnce();
    expect(runtime.getState(left).status).toBe("idle");
    expect(runtime.getState(right).status).toBe("idle");
  });

  it("reports a shared failure to every overlapping execute() caller", async () => {
    const failure = deferred<string>();
    const load = vi.fn(() => failure.promise);
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const first = runtime.execute([data]);
    const second = runtime.execute([data]);
    await waitForCondition(
      () => load.mock.calls.length === 1,
      "the shared loader to start",
    );
    failure.reject(new Error("shared failure"));

    const results = await Promise.allSettled([first, second]);
    expect(results.map(result => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    for (const result of results) {
      if (result.status !== "rejected") continue;
      expect(result.reason).toBeInstanceOf(GraphExecutionError);
      expect((result.reason as GraphExecutionError).failures).toEqual([
        expect.objectContaining({ nodeKey: "data", kind: "failed" }),
      ]);
    }
    expect(load).toHaveBeenCalledOnce();
    expect(runtime.getState(data)).toMatchObject({
      status: "error",
      hasSuccessfulValue: false,
    });
  });

  it("discards a shared attempt made obsolete mid-flight without failing any overlapping caller", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const results = [deferred<number>(), deferred<number>()];
    const load = vi.fn(({ get }) => {
      const index = get(context) - 1;
      const result = results[index];
      if (!result) throw new Error("Unexpected context value.");
      return result.promise;
    });
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    const first = runtime.execute([data]);
    const second = runtime.execute([data]);
    await waitForCondition(
      () => load.mock.calls.length === 1,
      "the shared loader to start",
    );
    expect(load).toHaveBeenCalledOnce();

    runtime.setContext(context, 2);
    const third = runtime.execute([data]);
    await waitForCondition(
      () => load.mock.calls.length === 2,
      "the replacement loader to start",
    );

    results[1]?.resolve(20);
    results[0]?.resolve(10);

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    await expect(third).resolves.toBeUndefined();

    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getState(data)).toMatchObject({
      data: 20,
      status: "success",
      freshness: "fresh",
    });
  });
});
