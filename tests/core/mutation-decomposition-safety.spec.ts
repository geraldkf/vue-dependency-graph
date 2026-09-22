import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  GraphMutationOutcomeUnknownError,
  GraphMutationReconciliationError,
  type EventInvalidationContext,
  type MutationSuccessEffects,
} from "../../src/core";

const createValue = (key: string) =>
  defineDataNode({
    key,
    initialValue: 0,
    load: async () => 1,
  });

const successfulMutation = (key: string) =>
  defineMutation({
    key,
    execute: async () => undefined,
  });

describe("mutation decomposition safety net", () => {
  it("treats an unchanged optimistic draft as no session", async () => {
    const value = createValue("decomposition-no-op-value");
    const mutation = successfulMutation("decomposition.no-op");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);
    const before = runtime.getState(value);
    const listener = vi.fn();
    runtime.onChange(listener);
    const localFailure = new Error("Local success failed");

    await expect(
      runtime.mutate(mutation, undefined, {
        optimistic: (effects) => effects.update(value, (current) => current),
        onSuccess: () => {
          throw localFailure;
        },
      }),
    ).rejects.toBe(localFailure);

    expect(runtime.getState(value)).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.getSchedulerState().isScheduled).toBe(false);
  });

  it("does not let a no-op optimistic draft retain ownership", async () => {
    const value = createValue("decomposition-no-op-ownership");
    const first = successfulMutation("decomposition.no-op-first");
    const second = successfulMutation("decomposition.no-op-second");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    await runtime.mutate(first, undefined, {
      optimistic: (effects) => effects.update(value, (current) => current),
    });

    await expect(
      runtime.mutate(second, undefined, {
        optimistic: (effects) => effects.update(value, (current) => current + 1),
      }),
    ).resolves.toBeUndefined();
    expect(runtime.getState(value).data).toBe(2);
  });

  it("invokes a throwing failure classifier once and commits one unknown-outcome transition", async () => {
    const value = createValue("decomposition-classifier-value");
    const remoteFailure = new Error("Remote outcome unavailable");
    const mutation = defineMutation({
      key: "decomposition.classifier",
      execute: async () => {
        throw remoteFailure;
      },
    });
    const classifyFailure = vi.fn(() => {
      throw new Error("Classifier failed");
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);
    const observed: string[] = [];
    runtime.onChange(() => {
      const state = runtime.getState(value);
      observed.push(`${state.data}:${state.freshness}:${state.generation}`);
    });

    let captured: unknown;
    try {
      await runtime.mutate(mutation, undefined, {
        optimistic: (effects) => effects.update(value, (current) => current + 10),
        classifyFailure,
      });
    } catch (error) {
      captured = error;
    }

    expect(classifyFailure).toHaveBeenCalledTimes(1);
    expect(captured).toBeInstanceOf(GraphMutationOutcomeUnknownError);
    expect((captured as Error).cause).toBe(remoteFailure);
    expect(observed).toEqual(["11:fresh:1", "11:stale:2"]);

    await expect(
      runtime.mutate(successfulMutation("decomposition.classifier-follow-up"), undefined, {
        optimistic: (effects) => effects.update(value, (current) => current + 1),
      }),
    ).resolves.toBeUndefined();
  });

  it("closes retained success effects after callback completion", async () => {
    const value = createValue("decomposition-effects-value");
    const invalidated = createValue("decomposition-effects-invalidated");
    const changed = defineEvent<void>("decomposition.effects-changed");
    const runtime = createGraphRuntime(createGraph({ nodes: [value, invalidated] }));
    await runtime.execute([value, invalidated]);
    let retained!: MutationSuccessEffects;

    await runtime.mutate(successfulMutation("decomposition.effects"), undefined, {
      onSuccess: (effects) => {
        retained = effects;
      },
    });

    expect(() => retained.update(value, (current) => current + 1)).toThrowError(
      "Mutation success effects are no longer active.",
    );
    expect(() => retained.invalidate([invalidated])).toThrowError(
      "Mutation success effects are no longer active.",
    );
    expect(() => retained.publish(changed, undefined)).toThrowError(
      "Mutation success effects are no longer active.",
    );
  });

  it("commits no earlier publication when a later predicate reads an affected derived node", async () => {
    const source = createValue("decomposition-publication-source");
    const summary = defineDerivedNode({
      key: "decomposition-publication-summary",
      dependencies: [source] as const,
      derive: ({ get }) => get(source) * 2,
    });
    const accepted = defineEvent<void>("decomposition.publication-accepted");
    const prohibited = defineEvent<void>("decomposition.publication-prohibited");
    const acceptedTarget = defineDataNode({
      key: "decomposition-publication-accepted-target",
      invalidatedBy: [accepted] as const,
      initialValue: 0,
      load: async () => 10,
    });
    const prohibitedTarget = defineDataNode({
      key: "decomposition-publication-prohibited-target",
      dependencies: [summary] as const,
      invalidatedBy: [
        {
          event: prohibited,
          when: ({ get }: EventInvalidationContext<typeof prohibited, readonly [typeof summary]>) =>
            get(summary) > 0,
        },
      ] as const,
      initialValue: 0,
      load: async () => 20,
    });
    const explicitTarget = createValue("decomposition-publication-explicit");
    const runtime = createGraphRuntime(
      createGraph({
        nodes: [acceptedTarget, prohibitedTarget, explicitTarget, summary, source],
      }),
    );
    await runtime.execute([acceptedTarget, prohibitedTarget, explicitTarget]);
    const beforeSource = runtime.getState(source);
    const beforeAccepted = runtime.getState(acceptedTarget);
    const beforeProhibited = runtime.getState(prohibitedTarget);
    const beforeExplicit = runtime.getState(explicitTarget);
    const listener = vi.fn();
    runtime.onChange(listener);

    await expect(
      runtime.mutate(successfulMutation("decomposition.publications"), undefined, {
        onSuccess: (effects) => {
          effects.update(source, () => 5);
          effects.invalidate([explicitTarget]);
          effects.publish(accepted, undefined);
          effects.publish(prohibited, undefined);
        },
      }),
    ).rejects.toMatchObject({
      name: "EventPredicateDependencyError",
      dependencyKey: summary.key,
    });

    expect(runtime.getState(source)).toEqual(beforeSource);
    expect(runtime.getState(acceptedTarget)).toEqual(beforeAccepted);
    expect(runtime.getState(prohibitedTarget)).toEqual(beforeProhibited);
    expect(runtime.getState(explicitTarget)).toEqual(beforeExplicit);
    expect(listener).not.toHaveBeenCalled();
  });

  it("releases ownership after an optimistic affected-derived reconciliation failure", async () => {
    const source = createValue("decomposition-reconciliation-source");
    const summary = defineDerivedNode({
      key: "decomposition-reconciliation-summary",
      dependencies: [source] as const,
      derive: ({ get }) => get(source) * 2,
    });
    const changed = defineEvent<void>("decomposition.reconciliation-changed");
    const target = defineDataNode({
      key: "decomposition-reconciliation-target",
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
      runtime.mutate(successfulMutation("decomposition.reconciliation-failure"), undefined, {
        optimistic: (effects) => effects.update(source, (current) => current + 1),
        onSuccess: (effects) => effects.publish(changed, undefined),
      }),
    ).rejects.toBeInstanceOf(GraphMutationReconciliationError);

    await expect(
      runtime.mutate(successfulMutation("decomposition.reconciliation-follow-up"), undefined, {
        optimistic: (effects) => effects.update(source, (current) => current + 1),
      }),
    ).resolves.toBeUndefined();
    expect(runtime.getState(source).data).toBe(3);
  });
});
