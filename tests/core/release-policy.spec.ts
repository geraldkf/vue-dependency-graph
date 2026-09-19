import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  GraphValidationError,
  releaseAfter,
  retain,
  type AnyNodeDefinition,
  type TimerEnvironment,
} from "../../src/core";

interface ScheduledTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

const createTestEnvironment = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, ScheduledTimer>();
  const environment: TimerEnvironment = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { id, dueAt: now + delayMs, callback });
      return id;
    },
    clearTimeout: handle => {
      if (typeof handle === "number") timers.delete(handle);
    },
    random: () => 0.5,
    isPaused: () => false,
    onPauseChange: () => () => undefined,
  };
  const advanceBy = (durationMs: number): void => {
    now += durationMs;
    while (true) {
      const next = [...timers.values()]
        .filter(timer => timer.dueAt <= now)
        .sort((left, right) =>
          left.dueAt === right.dueAt
            ? left.id - right.id
            : left.dueAt - right.dueAt
        )[0];
      if (!next) return;
      timers.delete(next.id);
      next.callback();
    }
  };
  return { environment, advanceBy, timerCount: () => timers.size };
};

describe("release policies", () => {
  it("releases an idle node's value after its configured duration", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      release: releaseAfter({ durationMs: 1_000 }),
      load: () => Promise.resolve(42),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      timerEnvironment: environment,
    });
    const subscription = runtime.subscribeNodes([Count]);
    await runtime.whenSettled();
    expect(runtime.getState(Count)).toMatchObject({ data: 42, hasSuccessfulValue: true });

    subscription.unsubscribe();
    advanceBy(999);
    expect(runtime.getState(Count)).toMatchObject({ hasSuccessfulValue: true });

    advanceBy(1);
    expect(runtime.getState(Count)).toMatchObject({
      data: 0,
      status: "idle",
      freshness: "stale",
      hasSuccessfulValue: false,
    });
  });

  it("cancels the release timer if resubscribed before it fires", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      release: releaseAfter({ durationMs: 1_000 }),
      load: () => Promise.resolve(42),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      timerEnvironment: environment,
    });
    const first = runtime.subscribeNodes([Count]);
    await runtime.whenSettled();
    first.unsubscribe();

    advanceBy(500);
    const second = runtime.subscribeNodes([Count]);
    advanceBy(600); // past the original 1000ms mark, but the timer was cancelled

    expect(runtime.getState(Count)).toMatchObject({ data: 42, hasSuccessfulValue: true });
    second.unsubscribe();
  });

  it("retain() opts a node out even when the runtime has a default", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const Pinned = defineDataNode({
      key: "pinned",
      initialValue: 0,
      release: retain(),
      load: () => Promise.resolve(1),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Pinned] }), {
      timerEnvironment: environment,
      releaseAfterMs: 100,
    });
    const subscription = runtime.subscribeNodes([Pinned]);
    await runtime.whenSettled();
    subscription.unsubscribe();

    advanceBy(10_000);

    expect(runtime.getState(Pinned)).toMatchObject({ data: 1, hasSuccessfulValue: true });
  });

  it("a node with no policy of its own falls back to the runtime's releaseAfterMs default", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      load: () => Promise.resolve(7),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      timerEnvironment: environment,
      releaseAfterMs: 2_000,
    });
    const subscription = runtime.subscribeNodes([Count]);
    await runtime.whenSettled();
    subscription.unsubscribe();

    advanceBy(1_999);
    expect(runtime.getState(Count)).toMatchObject({ hasSuccessfulValue: true });
    advanceBy(1);
    expect(runtime.getState(Count)).toMatchObject({ hasSuccessfulValue: false });
  });

  it("a node's own releaseAfter overrides a longer runtime default", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      release: releaseAfter({ durationMs: 100 }),
      load: () => Promise.resolve(7),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      timerEnvironment: environment,
      releaseAfterMs: 10_000,
    });
    const subscription = runtime.subscribeNodes([Count]);
    await runtime.whenSettled();
    subscription.unsubscribe();

    advanceBy(100);

    expect(runtime.getState(Count)).toMatchObject({ hasSuccessfulValue: false });
  });

  it("a required (not direct) subscriber keeps the node alive", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      release: releaseAfter({ durationMs: 100 }),
      load: () => Promise.resolve(7),
    });
    const Doubled = defineDerivedNode({
      key: "doubled",
      dependencies: [Count] as const,
      derive: ({ get }) => get(Count) * 2,
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [Count, Doubled] }),
      { timerEnvironment: environment }
    );
    // Subscribed only to the descendant - Count is a required, not direct, subscriber.
    const subscription = runtime.subscribeNodes([Doubled]);
    await runtime.whenSettled();

    advanceBy(10_000);

    expect(runtime.getState(Count)).toMatchObject({ hasSuccessfulValue: true });
    subscription.unsubscribe();
  });

  it("resubscribing after release triggers a genuinely fresh load, not a stale-generation reuse", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    let loadCount = 0;
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      release: releaseAfter({ durationMs: 100 }),
      load: () => {
        loadCount += 1;
        return Promise.resolve(loadCount * 10);
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      timerEnvironment: environment,
    });
    const first = runtime.subscribeNodes([Count]);
    await runtime.whenSettled();
    expect(runtime.getState(Count).data).toBe(10);
    first.unsubscribe();

    advanceBy(100);
    expect(runtime.getState(Count).hasSuccessfulValue).toBe(false);

    const second = runtime.subscribeNodes([Count]);
    await runtime.whenSettled();

    expect(loadCount).toBe(2);
    expect(runtime.getState(Count)).toMatchObject({ data: 20, hasSuccessfulValue: true, status: "success" });
    second.unsubscribe();
  });

  it("emits a node.value-released diagnostic event", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      release: releaseAfter({ durationMs: 250 }),
      load: () => Promise.resolve(1),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      timerEnvironment: environment,
      diagnostics: { sink: diagnostics },
    });
    const subscription = runtime.subscribeNodes([Count]);
    await runtime.whenSettled();
    subscription.unsubscribe();

    advanceBy(250);

    const released = diagnostics
      .getEvents()
      .find(event => event.type === "node.value-released");
    expect(released).toMatchObject({ nodeKey: "count", idleMs: 250 });
  });

  it("does not schedule a release timer for a node with no successful value", async () => {
    const { environment, advanceBy } = createTestEnvironment();
    const Failing = defineDataNode({
      key: "failing",
      initialValue: 0,
      release: releaseAfter({ durationMs: 100 }),
      load: () => Promise.reject(new Error("boom")),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Failing] }), {
      timerEnvironment: environment,
    });
    const subscription = runtime.subscribeNodes([Failing]);
    await runtime.whenSettled();
    expect(runtime.getState(Failing).hasSuccessfulValue).toBe(false);

    subscription.unsubscribe();
    advanceBy(1_000);

    // Nothing to release; state.error should remain exactly as the failed
    // load left it, not be reset by a release firing that shouldn't exist.
    expect(runtime.getState(Failing).error).not.toBeNull();
  });

  it("rejects a release policy on a context node", () => {
    const context = Object.freeze({
      key: "context",
      kind: "context",
      dependencies: Object.freeze([]),
      initialValue: 1,
      release: releaseAfter({ durationMs: 1_000 }),
    }) as unknown as AnyNodeDefinition;

    expect(() => createGraph({ nodes: [context] })).toThrow(GraphValidationError);
    try {
      createGraph({ nodes: [context] });
      throw new Error("Expected createGraph to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphValidationError);
      expect((error as GraphValidationError).code).toBe("INVALID_RELEASE_POLICY");
    }
  });
});
