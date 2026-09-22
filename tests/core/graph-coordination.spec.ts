import { describe, expect, it } from "vitest";
import { defineDataNode } from "../../src/core";
import { invalidate } from "../../src/core/state/transitions";
import { buildCoordination } from "./coordination-harness";
import { waitForCondition } from "./test-helpers";

/**
 * Exercises the coordination module on its own - the execution, scheduler,
 * subscriptions and invalidation controllers and the two edges that point
 * backwards along their construction order - without a full runtime.
 */
const build = buildCoordination;

describe("graph coordination", () => {
  it("constructs without running any callback or emitting any event", () => {
    const node = defineDataNode({ key: "a", initialValue: 0, load: async () => 1 });

    const { events } = build([node]);

    expect(events()).toEqual([]);
  });

  it("loads a subscribed node through the scheduler", async () => {
    const node = defineDataNode({ key: "a", initialValue: 0, load: async () => 7 });
    const { coordination, state } = build([node]);

    coordination.subscriptions.subscribeNodes([node]);
    await coordination.scheduler.whenSettled();

    expect(state.getNodeState("a")).toMatchObject({
      status: "success",
      data: 7,
    });
  });

  it("scheduler -> subscriptions edge: flushes only directly subscribed nodes", async () => {
    const subscribed = defineDataNode({ key: "subscribed", initialValue: 0, load: async () => 1 });
    const unsubscribed = defineDataNode({
      key: "unsubscribed",
      initialValue: 0,
      load: async () => 2,
    });
    const { coordination, state } = build([subscribed, unsubscribed]);

    coordination.subscriptions.subscribeNodes([subscribed]);
    await coordination.scheduler.whenSettled();

    expect(state.getNodeState("subscribed").status).toBe("success");
    expect(state.getNodeState("unsubscribed").status).toBe("idle");
  });

  it("execution -> invalidation edge: a changed refresh result invalidates descendants", async () => {
    let value = 1;
    const source = defineDataNode({ key: "source", initialValue: 0, load: async () => value });
    const child = defineDataNode({
      key: "child",
      dependencies: [source] as const,
      initialValue: 0,
      load: async ({ get }) => get(source) * 10,
    });
    const { coordination, state } = build([source, child]);
    await coordination.execution.execute([child], "explicit");
    expect(state.getNodeState("child").freshness).toBe("fresh");

    // Mark the source stale the way a refresh does, then reload it with a new value.
    invalidate(state.getNodeState("source"));
    value = 2;
    await coordination.execution.execute([source], "refresh");

    expect(state.getNodeState("source").data).toBe(2);
    expect(state.getNodeState("child").freshness).toBe("stale");
  });

  it("does not invalidate descendants when a refresh returns the same value", async () => {
    const source = defineDataNode({ key: "source", initialValue: 0, load: async () => 1 });
    const child = defineDataNode({
      key: "child",
      dependencies: [source] as const,
      initialValue: 0,
      load: async ({ get }) => get(source) * 10,
    });
    const { coordination, state } = build([source, child]);
    await coordination.execution.execute([child], "explicit");
    invalidate(state.getNodeState("source"));

    await coordination.execution.execute([source], "refresh");

    expect(state.getNodeState("child").freshness).toBe("fresh");
  });

  it("attributes the scheduler flush to the subscription that requested it", async () => {
    const node = defineDataNode({ key: "a", initialValue: 0, load: async () => 1 });
    const { coordination, events } = build([node]);

    coordination.subscriptions.subscribeNodes([node]);
    await coordination.scheduler.whenSettled();

    const added = events().find((event) => event.type === "subscription.added");
    const requested = events().find((event) => event.type === "scheduler.requested");
    expect(added?.operationId).toBeTruthy();
    expect(requested).toMatchObject({
      reason: "subscription",
      causeId: added?.operationId,
    });
  });

  it("aborts automatic-only work when the last subscriber unsubscribes", async () => {
    let signal: AbortSignal | undefined;
    const node = defineDataNode({
      key: "slow",
      initialValue: 0,
      load: ({ signal: loadSignal }) => {
        signal = loadSignal;
        return new Promise<number>(() => undefined);
      },
    });
    const { coordination } = build([node]);

    const subscription = coordination.subscriptions.subscribeNodes([node]);
    await waitForCondition(() => signal !== undefined, "load to start");
    expect(signal?.aborted).toBe(false);

    subscription.unsubscribe();

    expect(signal?.aborted).toBe(true);
  });
});
