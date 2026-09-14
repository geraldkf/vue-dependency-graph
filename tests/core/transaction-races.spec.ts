import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction execution races", () => {
  it("preserves a completion that commits before context generation advances as stale data", async () => {
    const context = defineContextNode({ key: "before-commit-context", initialValue: 1 });
    const attempt = deferred<string>();
    const data = defineDataNode({
      key: "before-commit-data",
      dependencies: [context] as const,
      initialValue: "initial",
      load: () => attempt.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    const execution = runtime.execute([data]);
    await waitForCondition(
      () => runtime.getState(data).status === "loading",
      "pre-commit execution to start"
    );

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      attempt.resolve("completed-before-commit");
      await waitForCondition(
        () => runtime.getState(data).data === "completed-before-commit",
        "execution to commit before context commit"
      );
      expect(runtime.getState(data).freshness).toBe("fresh");
    });
    await execution;

    expect(runtime.getState(data)).toMatchObject({
      data: "completed-before-commit",
      status: "success",
      freshness: "stale",
      error: null,
      generation: 1,
    });
  });

  it("prevents an ignored-abort completion after commit from overwriting stale state", async () => {
    const context = defineContextNode({ key: "after-commit-context", initialValue: 1 });
    const attempt = deferred<string>();
    const signals: AbortSignal[] = [];
    const data = defineDataNode({
      key: "after-commit-data",
      dependencies: [context] as const,
      initialValue: "initial",
      load: ({ signal }) => {
        signals.push(signal);
        return attempt.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    const execution = runtime.execute([data]);
    await waitForCondition(() => signals.length === 1, "ignored-abort attempt to start");

    await runtime.transaction(() => {
      runtime.setContext(context, 2);
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(runtime.getState(data)).toMatchObject({
      data: "initial",
      status: "idle",
      freshness: "stale",
      generation: 1,
    });

    attempt.resolve("obsolete-result");
    await execution;

    expect(runtime.getState(data)).toMatchObject({
      data: "initial",
      status: "idle",
      freshness: "stale",
      error: null,
      generation: 1,
    });
  });
});
