import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("scheduler settlement", () => {
  it("resolves immediately when idle and exposes a frozen state snapshot", async () => {
    const runtime = createGraphRuntime(createGraph({ nodes: [] }));
    await expect(runtime.whenSettled()).resolves.toBeUndefined();
    expect(Object.isFrozen(runtime.getSchedulerState())).toBe(true);
  });

  it("waits for queued and active work and resolves multiple waiters", async () => {
    const result = deferred<string>();
    const data = defineDataNode({ key: "data", initialValue: "", load: () => result.promise });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    runtime.subscribeNodes([data]);

    const first = runtime.whenSettled();
    const second = runtime.whenSettled();
    let settled = false;
    void first.then(() => { settled = true; });
    await waitForCondition(() => runtime.getSchedulerState().isRunning, "scheduler to run");
    expect(settled).toBe(false);

    result.resolve("loaded");
    await Promise.all([first, second]);
    expect(runtime.getSchedulerState()).toEqual({ isScheduled: false, isRunning: false, error: null });
  });
  it("returns independent frozen scheduler snapshots", () => {
    const data = defineDataNode({ key: "data", initialValue: "", load: async () => "loaded" });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const before = runtime.getSchedulerState();
    runtime.subscribeNodes([data]);
    const queued = runtime.getSchedulerState();

    expect(before.isScheduled).toBe(false);
    expect(queued.isScheduled).toBe(true);
    expect(before).not.toBe(queued);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(queued)).toBe(true);
  });

});


describe("scheduler observation", () => {
  it("exposes committed scheduler transitions without recursive scheduling", async () => {
    const data = defineDataNode({ key: "observed", initialValue: "", load: async () => "loaded" });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const observed: string[] = [];
    runtime.onChange(() => {
      const state = runtime.getSchedulerState();
      observed.push(`${state.isScheduled}:${state.isRunning}`);
    });

    runtime.subscribeNodes([data]);
    await runtime.whenSettled();

    expect(observed).toContain("true:false");
    expect(observed).toContain("false:true");
    expect(observed[observed.length - 1]).toBe("false:false");
  });
});
