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

const save = defineMutation({
  key: "mutation-derived-predicate.save",
  execute: async () => undefined,
});

const changed = defineEvent<number>("mutation-derived-predicate.changed");

describe("mutation event predicate derived restrictions", () => {
  it("rejects an affected derived dependency before any success effect commits", async () => {
    const source = defineDataNode({
      key: "mutation-derived-predicate-source",
      initialValue: 0,
      load: async () => 1,
    });
    const summary = defineDerivedNode({
      key: "mutation-derived-predicate-summary",
      dependencies: [source] as const,
      derive: ({ get }) => get(source) * 2,
    });
    const eventTarget = defineDataNode({
      key: "mutation-derived-predicate-target",
      dependencies: [summary] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({ get }: EventInvalidationContext<typeof changed, readonly [typeof summary]>) =>
            get(summary) > 0,
        },
      ] as const,
      initialValue: 0,
      load: async () => 10,
    });
    const explicitTarget = defineDataNode({
      key: "mutation-derived-predicate-explicit",
      initialValue: 0,
      load: async () => 20,
    });
    const runtime = createGraphRuntime(
      createGraph({
        nodes: [eventTarget, explicitTarget, summary, source],
      }),
    );
    await runtime.execute([eventTarget, explicitTarget]);
    const beforeSource = runtime.getState(source);
    const beforeSummary = runtime.getState(summary);
    const beforeEventTarget = runtime.getState(eventTarget);
    const beforeExplicitTarget = runtime.getState(explicitTarget);
    const listener = vi.fn();
    runtime.onChange(listener);

    await expect(
      runtime.mutate(save, undefined, {
        onSuccess: (effects) => {
          effects.update(source, () => 5);
          effects.invalidate([explicitTarget]);
          effects.publish(changed, 5);
        },
      }),
    ).rejects.toMatchObject({
      name: "EventPredicateDependencyError",
      nodeKey: eventTarget.key,
      dependencyKey: summary.key,
    });

    expect(runtime.getState(source)).toEqual(beforeSource);
    expect(runtime.getState(summary)).toEqual(beforeSummary);
    expect(runtime.getState(eventTarget)).toEqual(beforeEventTarget);
    expect(runtime.getState(explicitTarget)).toEqual(beforeExplicitTarget);
    expect(listener).not.toHaveBeenCalled();
  });

  it("recovers optimistic state when remote success reads an affected derived dependency", async () => {
    const source = defineDataNode({
      key: "mutation-derived-predicate-optimistic-source",
      initialValue: 0,
      load: async () => 1,
    });
    const summary = defineDerivedNode({
      key: "mutation-derived-predicate-optimistic-summary",
      dependencies: [source] as const,
      derive: ({ get }) => get(source) * 2,
    });
    const target = defineDataNode({
      key: "mutation-derived-predicate-optimistic-target",
      dependencies: [summary] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({ get }: EventInvalidationContext<typeof changed, readonly [typeof summary]>) =>
            get(summary) > 0,
        },
      ] as const,
      initialValue: 0,
      load: async () => 10,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target, summary, source] }));
    await runtime.execute([target]);

    await expect(
      runtime.mutate(save, undefined, {
        optimistic: (effects) => effects.update(source, (current) => current + 1),
        onSuccess: (effects) => effects.publish(changed, 2),
      }),
    ).rejects.toMatchObject({
      name: "GraphMutationReconciliationError",
      mutationKey: save.key,
      remoteSucceeded: true,
      cause: {
        name: "EventPredicateDependencyError",
        nodeKey: target.key,
        dependencyKey: summary.key,
      },
    });

    expect(runtime.getState(source)).toMatchObject({
      data: 2,
      freshness: "stale",
    });
    expect(runtime.getState(summary).freshness).toBe("stale");
    expect(runtime.getState(target).freshness).toBe("stale");
  });

  it("rejects a derived dependency affected by explicit invalidation", async () => {
    const source = defineDataNode({
      key: "mutation-derived-predicate-explicit-source",
      initialValue: 0,
      load: async () => 1,
    });
    const summary = defineDerivedNode({
      key: "mutation-derived-predicate-explicit-summary",
      dependencies: [source] as const,
      derive: ({ get }) => get(source) * 2,
    });
    const target = defineDataNode({
      key: "mutation-derived-predicate-explicit-target",
      dependencies: [summary] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({ get }: EventInvalidationContext<typeof changed, readonly [typeof summary]>) =>
            get(summary) === 2,
        },
      ] as const,
      initialValue: 0,
      load: async () => 10,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target, summary, source] }));
    await runtime.execute([target]);
    const beforeSource = runtime.getState(source);
    const beforeSummary = runtime.getState(summary);
    const beforeTarget = runtime.getState(target);

    await expect(
      runtime.mutate(save, undefined, {
        onSuccess: (effects) => {
          effects.invalidate([source]);
          effects.publish(changed, 2);
        },
      }),
    ).rejects.toMatchObject({
      name: "EventPredicateDependencyError",
      dependencyKey: summary.key,
    });

    expect(runtime.getState(source)).toEqual(beforeSource);
    expect(runtime.getState(summary)).toEqual(beforeSummary);
    expect(runtime.getState(target)).toEqual(beforeTarget);
  });

  it("allows an unaffected derived dependency", async () => {
    const updated = defineDataNode({
      key: "mutation-derived-predicate-unaffected-updated",
      initialValue: 0,
      load: async () => 1,
    });
    const stable = defineDataNode({
      key: "mutation-derived-predicate-unaffected-stable",
      initialValue: 0,
      load: async () => 2,
    });
    const stableSummary = defineDerivedNode({
      key: "mutation-derived-predicate-unaffected-summary",
      dependencies: [stable] as const,
      derive: ({ get }) => get(stable) * 2,
    });
    const target = defineDataNode({
      key: "mutation-derived-predicate-unaffected-target",
      dependencies: [stableSummary] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({
            get,
          }: EventInvalidationContext<typeof changed, readonly [typeof stableSummary]>) =>
            get(stableSummary) === 4,
        },
      ] as const,
      initialValue: 0,
      load: async () => 10,
    });
    const runtime = createGraphRuntime(
      createGraph({
        nodes: [target, stableSummary, stable, updated],
      }),
    );
    await runtime.execute([target, updated]);

    await runtime.mutate(save, undefined, {
      onSuccess: (effects) => {
        effects.update(updated, () => 5);
        effects.publish(changed, 5);
      },
    });

    expect(runtime.getState(updated).data).toBe(5);
    expect(runtime.getState(stableSummary)).toMatchObject({
      data: 4,
      freshness: "fresh",
    });
    expect(runtime.getState(target).freshness).toBe("stale");
  });

  it("continues to expose directly updated data through the event overlay", async () => {
    const selected = defineDataNode({
      key: "mutation-derived-predicate-overlay-selected",
      initialValue: 0,
      load: async () => 1,
    });
    const target = defineDataNode({
      key: "mutation-derived-predicate-overlay-target",
      dependencies: [selected] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({
            payload,
            get,
          }: EventInvalidationContext<typeof changed, readonly [typeof selected]>) =>
            get(selected) === payload,
        },
      ] as const,
      initialValue: 0,
      load: async () => 10,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target, selected] }));
    await runtime.execute([target]);

    await runtime.mutate(save, undefined, {
      onSuccess: (effects) => {
        effects.update(selected, () => 5);
        effects.publish(changed, 5);
      },
    });

    expect(runtime.getState(selected).data).toBe(5);
    expect(runtime.getState(target).freshness).toBe("stale");
  });

  it("leaves normal runtime and transaction derived predicate reads unchanged", async () => {
    const context = defineContextNode({
      key: "mutation-derived-predicate-compat-context",
      initialValue: 1,
    });
    const summary = defineDerivedNode({
      key: "mutation-derived-predicate-compat-summary",
      dependencies: [context] as const,
      derive: ({ get }) => get(context) * 2,
    });
    const target = defineDataNode({
      key: "mutation-derived-predicate-compat-target",
      dependencies: [summary] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({ get }: EventInvalidationContext<typeof changed, readonly [typeof summary]>) =>
            get(summary) === 2,
        },
      ] as const,
      initialValue: 0,
      load: async () => 10,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [target, summary, context] }));
    await runtime.execute([target]);

    runtime.publish(changed, 1);
    expect(runtime.getState(target).freshness).toBe("stale");
    await runtime.execute([target]);

    await runtime.transaction((transaction) => {
      transaction.setContext(context, 2);
      transaction.publish(changed, 2);
    });

    expect(runtime.getState(context).data).toBe(2);
    expect(runtime.getState(target).freshness).toBe("stale");
  });
});
