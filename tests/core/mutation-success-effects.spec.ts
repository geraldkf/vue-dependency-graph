import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  type EventInvalidationContext,
} from "../../src/core";

const CompleteSave = defineEvent<{ readonly id: number }>("save.completed");
const save = defineMutation({
  key: "save.complete",
  execute: async ({ input }: { input: { id: number }; signal: AbortSignal }) => ({
    id: input.id,
  }),
});

describe("mutation success effects", () => {
  it("combines direct updates and explicit invalidation into one notification", async () => {
    const updated = defineDataNode({
      key: "success-effects-updated",
      initialValue: 0,
      load: async () => 1,
    });
    const invalidated = defineDataNode({
      key: "success-effects-invalidated",
      initialValue: "initial",
      load: async () => "loaded",
    });
    const child = defineDerivedNode({
      key: "success-effects-child",
      dependencies: [invalidated] as const,
      derive: ({ get }) => get(invalidated).length,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [updated, child, invalidated] }));
    await runtime.execute([updated, child]);
    const snapshots: string[] = [];
    runtime.onChange(() => {
      snapshots.push(
        `${runtime.getState(updated).data}:${runtime.getState(invalidated).freshness}:${runtime.getState(child).freshness}`,
      );
    });

    await runtime.mutate(
      save,
      { id: 5 },
      {
        onSuccess: (effects, result) => {
          effects.update(updated, () => result.id);
          effects.invalidate([invalidated]);
        },
      },
    );

    expect(runtime.getState(updated)).toMatchObject({
      data: 5,
      status: "success",
      freshness: "fresh",
      generation: 1,
    });
    expect(runtime.getState(invalidated)).toMatchObject({
      data: "loaded",
      status: "success",
      freshness: "stale",
      generation: 1,
    });
    expect(runtime.getState(child)).toMatchObject({
      data: 6,
      status: "success",
      freshness: "stale",
      generation: 1,
    });
    expect(snapshots).toEqual(["5:stale:stale"]);
  });

  it("retains a direct response value as stale when the same node is invalidated", async () => {
    const value = defineDataNode({
      key: "success-effects-update-and-invalidate",
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    await runtime.mutate(
      save,
      { id: 5 },
      {
        onSuccess: (effects, result) => {
          effects.update(value, () => result.id);
          effects.invalidate([value]);
        },
      },
    );

    expect(runtime.getState(value)).toMatchObject({
      data: 5,
      status: "success",
      freshness: "stale",
      generation: 1,
      hasSuccessfulValue: true,
    });
  });

  it("publishes typed events only after remote success", async () => {
    const target = defineDataNode({
      key: "success-effects-event-target",
      invalidatedBy: [CompleteSave] as const,
      initialValue: "initial",
      load: async () => "loaded",
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target] }));
    await runtime.execute([target]);

    await runtime.mutate(
      save,
      { id: 5 },
      {
        onSuccess: (effects, result) => {
          effects.publish(CompleteSave, { id: result.id });
        },
      },
    );

    expect(runtime.getState(target)).toMatchObject({
      data: "loaded",
      freshness: "stale",
      generation: 1,
    });
  });

  it("evaluates event predicates against final direct-update values", async () => {
    const selectedId = defineDataNode({
      key: "success-effects-selected-id",
      initialValue: 0,
      load: async () => 1,
    });
    const target = defineDataNode({
      key: "success-effects-conditional-target",
      dependencies: [selectedId] as const,
      invalidatedBy: [
        {
          event: CompleteSave,
          when: ({
            payload,
            get,
          }: EventInvalidationContext<typeof CompleteSave, readonly [typeof selectedId]>) =>
            payload.id === get(selectedId),
        },
      ] as const,
      initialValue: "initial",
      load: async () => "loaded",
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target, selectedId] }));
    await runtime.execute([target]);

    await runtime.mutate(
      save,
      { id: 5 },
      {
        onSuccess: (effects, result) => {
          effects.update(selectedId, () => result.id);
          effects.publish(CompleteSave, { id: result.id });
        },
      },
    );

    expect(runtime.getState(selectedId)).toMatchObject({
      data: 5,
      freshness: "fresh",
      generation: 1,
    });
    expect(runtime.getState(target)).toMatchObject({
      data: "loaded",
      freshness: "stale",
      generation: 1,
    });
  });

  it("applies no effect when an event predicate throws", async () => {
    const failure = new Error("Predicate failed");
    const event = defineEvent<void>("save.predicate-failed");
    const updated = defineDataNode({
      key: "success-effects-predicate-updated",
      initialValue: 0,
      load: async () => 1,
    });
    const target = defineDataNode({
      key: "success-effects-predicate-target",
      invalidatedBy: [
        {
          event,
          when: () => {
            throw failure;
          },
        },
      ] as const,
      initialValue: "initial",
      load: async () => "loaded",
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [updated, target] }));
    await runtime.execute([updated, target]);
    const beforeUpdated = runtime.getState(updated);
    const beforeTarget = runtime.getState(target);
    const listener = vi.fn();
    runtime.onChange(listener);

    await expect(
      runtime.mutate(
        save,
        { id: 5 },
        {
          onSuccess: (effects) => {
            effects.update(updated, () => 5);
            effects.publish(event, undefined);
          },
        },
      ),
    ).rejects.toBe(failure);

    expect(runtime.getState(updated)).toEqual(beforeUpdated);
    expect(runtime.getState(target)).toEqual(beforeTarget);
    expect(listener).not.toHaveBeenCalled();
  });

  it("deduplicates explicit and event invalidation across shared descendants", async () => {
    const left = defineDataNode({
      key: "success-effects-left",
      invalidatedBy: [CompleteSave] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const right = defineDataNode({
      key: "success-effects-right",
      initialValue: 0,
      load: async () => 2,
    });
    const shared = defineDerivedNode({
      key: "success-effects-shared",
      dependencies: [left, right] as const,
      derive: ({ get }) => get(left) + get(right),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [shared, right, left] }));
    await runtime.execute([shared]);
    const listener = vi.fn();
    runtime.onChange(listener);

    await runtime.mutate(
      save,
      { id: 5 },
      {
        onSuccess: (effects) => {
          effects.invalidate([right]);
          effects.publish(CompleteSave, { id: 5 });
        },
      },
    );

    expect(runtime.getState(left).generation).toBe(1);
    expect(runtime.getState(right).generation).toBe(1);
    expect(runtime.getState(shared).generation).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("schedules subscribed invalidated nodes once through the existing scheduler", async () => {
    let requestCount = 0;
    const target = defineDataNode({
      key: "success-effects-scheduled-target",
      initialValue: 0,
      load: async () => {
        requestCount += 1;
        return requestCount;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target] }));
    const subscription = runtime.subscribeNodes([target]);
    await runtime.whenSettled();

    await runtime.mutate(
      save,
      { id: 5 },
      {
        onSuccess: (effects) => effects.invalidate([target]),
      },
    );
    await runtime.whenSettled();

    expect(requestCount).toBe(2);
    expect(runtime.getState(target)).toMatchObject({
      data: 2,
      freshness: "fresh",
      status: "success",
    });
    subscription.unsubscribe();
  });

  it("does not publish success effects when remote execution rejects", async () => {
    const failure = new Error("Remote rejected");
    const rejected = defineMutation({
      key: "save.rejected",
      execute: async () => {
        throw failure;
      },
    });
    const target = defineDataNode({
      key: "success-effects-rejected-target",
      invalidatedBy: [CompleteSave] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target] }));
    await runtime.execute([target]);
    const onSuccess = vi.fn();

    await expect(
      runtime.mutate(rejected, undefined, {
        onSuccess,
      }),
    ).rejects.toBe(failure);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(runtime.getState(target)).toMatchObject({
      data: 1,
      freshness: "fresh",
      generation: 0,
    });
  });

  it("rejects context invalidation supplied by untyped JavaScript", async () => {
    const context = defineContextNode({
      key: "success-effects-invalid-context",
      initialValue: 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await expect(
      runtime.mutate(
        save,
        { id: 5 },
        {
          onSuccess: (effects) => {
            effects.invalidate([context as never]);
          },
        },
      ),
    ).rejects.toMatchObject({
      name: "GraphMutationStateError",
      nodeKey: context.key,
    });

    expect(runtime.getState(context).generation).toBe(0);
  });
});
