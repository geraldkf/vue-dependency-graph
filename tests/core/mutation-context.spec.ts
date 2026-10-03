import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineMutation,
  GraphMutationReconciliationError,
  GraphMutationConflictError,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("mutation context identity", () => {
  it("rejects an optimistic draft if selection changes before remote work starts", async () => {
    const selected = defineContextNode({ key: "selected", initialValue: "A" });
    const detail = defineDataNode({
      key: "detail",
      dependencies: [selected],
      initialValue: "",
      load: async ({ get }) => get(selected),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [selected, detail] }));
    await runtime.execute([detail]);
    const execute = vi.fn(async () => "saved A");
    const saving = runtime.mutate(defineMutation({ key: "save", execute }), undefined, {
      optimistic: (e) => e.update(detail, () => "optimistic A"),
    });
    const rejected = expect(saving).rejects.toBeInstanceOf(GraphMutationConflictError);
    runtime.setContext(selected, "B");
    await rejected;
    expect(execute).not.toHaveBeenCalled();
    expect(runtime.getState(detail).data).toBe("A");
    await runtime.execute([detail]);
    expect(runtime.getState(detail).data).toBe("B");
    runtime.shutdown();
  });
  it.each([false, true])(
    "preserves a new entity on late success (optimistic=%s)",
    async (optimistic) => {
      const selected = defineContextNode({ key: "selected", initialValue: "A" });
      const identity = defineDerivedNode({
        key: "identity",
        dependencies: [selected],
        derive: ({ get }) => get(selected),
      });
      const detail = defineDataNode({
        key: "detail",
        dependencies: [identity],
        initialValue: { id: "", value: "" },
        load: async ({ get }) => ({ id: get(identity), value: "loaded" }),
      });
      const other = defineDataNode({ key: "other", initialValue: 0, load: async () => 1 });
      const runtime = createGraphRuntime(
        createGraph({ nodes: [selected, identity, detail, other] }),
      );
      await runtime.execute([detail, other]);
      const remote = deferred<{ id: string; value: string }>();
      let started = false;
      const save = defineMutation({
        key: "save",
        execute: () => {
          started = true;
          return remote.promise;
        },
      });
      const saving = runtime.mutate(save, undefined, {
        ...(optimistic
          ? {
              optimistic: (effects: import("../../src/core").MutationUpdateEffects) =>
                effects.update(detail, (v) => ({ ...v, value: "optimistic" })),
            }
          : {}),
        onSuccess: (effects, result) => {
          effects.update(other, () => 99);
          effects.update(detail, () => result);
        },
      });
      const rejected = expect(saving).rejects.toMatchObject({
        remoteSucceeded: true,
        nodeKeys: ["detail"],
      });
      await waitForCondition(() => started, "mutation started");
      runtime.setContext(selected, "B");
      await runtime.execute([detail]);
      remote.resolve({ id: "A", value: "saved" });
      await rejected;
      expect(runtime.getState(detail).data).toEqual({ id: "B", value: "loaded" });
      expect(runtime.getState(other).data).toBe(1);
      runtime.dispose();
    },
  );

  it("allows same-context refreshes and unrelated context changes", async () => {
    const selected = defineContextNode({ key: "selected", initialValue: "A" });
    const unrelated = defineContextNode({ key: "unrelated", initialValue: 0 });
    const detail = defineDataNode({
      key: "detail",
      dependencies: [selected],
      initialValue: "",
      load: async ({ get }) => get(selected),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [selected, unrelated, detail] }));
    await runtime.execute([detail]);
    const remote = deferred<string>();
    const save = defineMutation({ key: "save", execute: () => remote.promise });
    const saving = runtime.mutate(save, undefined, {
      onSuccess: (e, result) => e.update(detail, () => result),
    });
    runtime.setContext(unrelated, 1);
    await runtime.refresh([detail]);
    remote.resolve("saved A");
    await saving;
    expect(runtime.getState(detail).data).toBe("saved A");
    runtime.dispose();
  });

  it("rejects switching away and back while the request is pending", async () => {
    const selected = defineContextNode({ key: "selected", initialValue: "A" });
    const detail = defineDataNode({
      key: "detail",
      dependencies: [selected],
      initialValue: "",
      load: async ({ get }) => get(selected),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [selected, detail] }));
    await runtime.execute([detail]);
    const remote = deferred<string>();
    const saving = runtime.mutate(
      defineMutation({ key: "save", execute: () => remote.promise }),
      undefined,
      { onSuccess: (e, result) => e.update(detail, () => result) },
    );
    const rejected = expect(saving).rejects.toBeInstanceOf(GraphMutationReconciliationError);
    runtime.setContext(selected, "B");
    runtime.setContext(selected, "A");
    remote.resolve("obsolete");
    await rejected;
    expect(runtime.getState(detail).data).toBe("A");
    runtime.dispose();
  });
});
