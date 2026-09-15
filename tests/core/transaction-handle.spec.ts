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

  it("closes nested handles together when their shared session closes", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    let outerHandle!: GraphTransaction;
    let nestedHandle!: GraphTransaction;

    await runtime.transaction(async transaction => {
      outerHandle = transaction;
      await transaction.transaction(inner => {
        nestedHandle = inner;
        inner.setContext(context, 2);
      });
    });

    expect(runtime.getState(context).data).toBe(2);
    expect(() => outerHandle.setContext(context, 3)).toThrow(
      "Graph transaction is no longer active."
    );
    expect(() => nestedHandle.setContext(context, 3)).toThrow(
      "Graph transaction is no longer active."
    );
  });

  describe("explicit nesting via transaction.transaction(...)", () => {
    it("commits nested work as part of the same session", async () => {
      const context = defineContextNode({ key: "context", initialValue: 1 });
      const other = defineContextNode({ key: "other", initialValue: 10 });
      const runtime = createGraphRuntime(createGraph({ nodes: [context, other] }));

      const result = await runtime.transaction(async transaction => {
        transaction.setContext(context, 2);
        const innerResult = await transaction.transaction(inner => {
          inner.setContext(other, 20);
          return "inner-done" as const;
        });
        return innerResult;
      });

      expect(result).toBe("inner-done");
      expect(runtime.getState(context).data).toBe(2);
      expect(runtime.getState(other).data).toBe(20);
    });

    it("rolls back the whole session, including the outer's own writes, when nested work throws", async () => {
      const context = defineContextNode({ key: "context", initialValue: 1 });
      const other = defineContextNode({ key: "other", initialValue: 10 });
      const runtime = createGraphRuntime(createGraph({ nodes: [context, other] }));

      await expect(
        runtime.transaction(async transaction => {
          transaction.setContext(context, 2);
          await transaction.transaction(inner => {
            inner.setContext(other, 20);
            throw new Error("nested failure");
          });
        })
      ).rejects.toThrow("nested failure");

      // The nested call never had its own commit boundary -- both writes
      // belong to the same session, so the outer's own write is discarded
      // too, unlike ambient re-entrant nesting (see C1's findings).
      expect(runtime.getState(context)).toMatchObject({ data: 1, generation: 0 });
      expect(runtime.getState(other)).toMatchObject({ data: 10, generation: 0 });
    });

    it("propagates a conflict detected on nested work to the outer caller", async () => {
      const context = defineContextNode({ key: "context", initialValue: 1 });
      const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

      const outerTransaction = runtime.transaction(async transaction => {
        await transaction.transaction(inner => {
          inner.setContext(context, 2);
        });
        // An unrelated immediate write changes the generation the nested
        // call already staged against, before this (outer) session commits.
        runtime.setContext(context, 99);
      });

      await expect(outerTransaction).rejects.toThrow(
        "Graph transaction conflicted with context changes: context."
      );
      expect(runtime.getState(context).data).toBe(99);
    });

    it("throws when called after the parent transaction has already settled", async () => {
      const runtime = createGraphRuntime(createGraph({ nodes: [] }));
      let captured!: GraphTransaction;

      await runtime.transaction(transaction => {
        captured = transaction;
      });

      expect(() => captured.transaction(() => undefined)).toThrow(
        "Graph transaction is no longer active."
      );
    });
  });
});
