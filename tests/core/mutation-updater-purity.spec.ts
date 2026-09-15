import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineMutation,
  GraphMutationStateError,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

interface NestedValue {
  readonly count: number;
  readonly nested: {
    readonly label: string;
  };
}

const save = defineMutation({
  key: "mutation-purity.save",
  execute: async () => undefined,
});

const createArrayNode = (key: string) =>
  defineDataNode({
    key,
    initialValue: [] as number[],
    load: async () => [1, 2],
  });

const createObjectNode = (key: string) =>
  defineDataNode({
    key,
    initialValue: {
      count: 0,
      nested: { label: "initial" },
    } as NestedValue,
    load: async () => ({
      count: 1,
      nested: { label: "loaded" },
    }),
  });

describe("mutation updater purity", () => {
  it("supports immutable array and object replacements", async () => {
    const list = createArrayNode("mutation-purity-immutable-array");
    const value = createObjectNode("mutation-purity-immutable-object");
    const runtime = createGraphRuntime(createGraph({ nodes: [list, value] }));
    await runtime.execute([list, value]);

    await runtime.mutate(save, undefined, {
      onSuccess: effects => {
        effects.update(list, current => [...current, 3]);
        effects.update(value, current => ({
          ...current,
          nested: { label: "updated" },
        }));
      },
    });

    expect(runtime.getState(list).data).toEqual([1, 2, 3]);
    expect(runtime.getState(value).data).toEqual({
      count: 1,
      nested: { label: "updated" },
    });
  });

  it("rejects direct array mutation without changing graph state", async () => {
    const list = createArrayNode("mutation-purity-array-write");
    const runtime = createGraphRuntime(createGraph({ nodes: [list] }));
    await runtime.execute([list]);
    const before = runtime.getState(list);
    const listener = vi.fn();
    runtime.onChange(listener);

    await expect(runtime.mutate(save, undefined, {
      onSuccess: effects => effects.update(list, current => {
        current.push(3);
        return current;
      }),
    })).rejects.toMatchObject({
      name: "GraphMutationStateError",
      nodeKey: list.key,
    });

    expect(runtime.getState(list)).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects direct object-property mutation", async () => {
    const value = createObjectNode("mutation-purity-object-write");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);
    const before = runtime.getState(value);

    await expect(runtime.mutate(save, undefined, {
      onSuccess: effects => effects.update(value, current => {
        (current as { count: number }).count = 2;
        return current;
      }),
    })).rejects.toBeInstanceOf(GraphMutationStateError);

    expect(runtime.getState(value)).toEqual(before);
  });

  it("rejects nested plain-object mutation", async () => {
    const value = createObjectNode("mutation-purity-nested-write");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);
    const before = runtime.getState(value);

    await expect(runtime.mutate(save, undefined, {
      onSuccess: effects => effects.update(value, current => {
        (current.nested as { label: string }).label = "mutated";
        return current;
      }),
    })).rejects.toMatchObject({
      name: "GraphMutationStateError",
      nodeKey: value.key,
    });

    expect(runtime.getState(value)).toEqual(before);
  });

  it("leaks no earlier in-place change when a later updater throws", async () => {
    const list = createArrayNode("mutation-purity-multi-array");
    const value = createObjectNode("mutation-purity-multi-object");
    const runtime = createGraphRuntime(createGraph({ nodes: [list, value] }));
    await runtime.execute([list, value]);
    const beforeList = runtime.getState(list);
    const beforeValue = runtime.getState(value);

    await expect(runtime.mutate(save, undefined, {
      onSuccess: effects => {
        effects.update(list, current => {
          current.push(3);
          return current;
        });
        effects.update(value, () => {
          throw new Error("Later updater failed");
        });
      },
    })).rejects.toBeInstanceOf(GraphMutationStateError);

    expect(runtime.getState(list)).toEqual(beforeList);
    expect(runtime.getState(value)).toEqual(beforeValue);
  });

  it("rejects optimistic in-place mutation before request execution or ownership", async () => {
    const list = createArrayNode("mutation-purity-optimistic");
    const execute = vi.fn(async () => undefined);
    const mutation = defineMutation({
      key: "mutation-purity.optimistic",
      execute,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [list] }));
    await runtime.execute([list]);
    const before = runtime.getState(list);

    await expect(runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(list, current => {
        current.push(3);
        return current;
      }),
    })).rejects.toBeInstanceOf(GraphMutationStateError);

    expect(execute).not.toHaveBeenCalled();
    expect(runtime.getState(list)).toEqual(before);

    await expect(runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(list, current => [...current, 3]),
    })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("applies no partial success effect when an in-place updater is rejected", async () => {
    const list = createArrayNode("mutation-purity-success-array");
    const value = createObjectNode("mutation-purity-success-object");
    const runtime = createGraphRuntime(createGraph({ nodes: [list, value] }));
    await runtime.execute([list, value]);
    const beforeList = runtime.getState(list);
    const beforeValue = runtime.getState(value);

    await expect(runtime.mutate(save, undefined, {
      onSuccess: effects => {
        effects.update(value, current => ({ ...current, count: 2 }));
        effects.update(list, current => {
          current.pop();
          return current;
        });
      },
    })).rejects.toBeInstanceOf(GraphMutationStateError);

    expect(runtime.getState(list)).toEqual(beforeList);
    expect(runtime.getState(value)).toEqual(beforeValue);
  });

  it("supports immutable replacement of a non-plain value", async () => {
    const timestamp = defineDataNode({
      key: "mutation-purity-date",
      initialValue: new Date(0),
      load: async () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [timestamp] }));
    await runtime.execute([timestamp]);

    await runtime.mutate(save, undefined, {
      onSuccess: effects => effects.update(
        timestamp,
        current => new Date(current.getTime() + 1_000),
      ),
    });

    expect(runtime.getState(timestamp).data.toISOString()).toBe(
      "2026-01-01T00:00:01.000Z",
    );
  });

  it("does not retain protected nested proxies in replacement values", async () => {
    const request = deferred<void>();
    const value = createObjectNode("mutation-purity-proxy-release");
    const mutation = defineMutation({
      key: "mutation-purity.proxy-release",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(value, current => ({
        ...current,
        count: 2,
      })),
    });
    await waitForCondition(
      () => runtime.getState(value).data.count === 2,
      "immutable optimistic object replacement",
    );

    expect(() => {
      const data = runtime.getState(value).data as {
        nested: { label: string };
      };
      data.nested.label = "application-owned write";
    }).not.toThrow();

    request.resolve();
    await pending;
  });
});
