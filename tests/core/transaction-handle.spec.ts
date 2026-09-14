import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineEvent,
  type GraphTransaction,
} from "../../src/core";

describe("graph transaction handle lifecycle", () => {
  it("preserves the transaction callback result type and value", async () => {
    const runtime = createGraphRuntime(createGraph({ nodes: [] }));

    const result = await runtime.transaction(() => "completed" as const);

    expect(result).toBe("completed");
  });

  it("rejects context writes through a handle after commit", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const listener = vi.fn();
    runtime.onChange(listener);
    let captured!: GraphTransaction;

    await runtime.transaction(transaction => {
      captured = transaction;
    });

    expect(() => captured.setContext(context, 2)).toThrow(
      "Graph transaction is no longer active."
    );
    expect(runtime.getState(context)).toMatchObject({ data: 1, generation: 0 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects context writes and publications through a handle after rollback", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const changed = defineEvent<void>("changed");
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    let captured!: GraphTransaction;

    await expect(
      runtime.transaction(transaction => {
        captured = transaction;
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");

    expect(() => captured.setContext(context, 2)).toThrow(
      "Graph transaction is no longer active."
    );
    expect(() => captured.publish(changed, undefined)).toThrow(
      "Graph transaction is no longer active."
    );
    expect(runtime.getState(context)).toMatchObject({ data: 1, generation: 0 });
  });

  it("closes joined handles together when the shared group closes", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    let rootHandle!: GraphTransaction;
    let joinedHandle!: GraphTransaction;

    await runtime.transaction(async transaction => {
      rootHandle = transaction;
      await runtime.transaction(joinedTransaction => {
        joinedHandle = joinedTransaction;
        joinedTransaction.setContext(context, 2);
      });
    });

    expect(runtime.getState(context).data).toBe(2);
    expect(() => rootHandle.setContext(context, 3)).toThrow(
      "Graph transaction is no longer active."
    );
    expect(() => joinedHandle.setContext(context, 3)).toThrow(
      "Graph transaction is no longer active."
    );
  });
});
