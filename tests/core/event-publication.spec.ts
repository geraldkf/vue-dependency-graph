import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  type EventInvalidationContext,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("event publication", () => {
  it("invalidates matching nodes and descendants while retaining successful data", async () => {
    const changed = defineEvent<{ id: number }>("domain.changed");
    const root = defineDataNode({
      key: "root",
      invalidatedBy: [changed] as const,
      initialValue: "initial",
      load: async () => "loaded",
    });
    const descendant = defineDerivedNode({
      key: "descendant",
      dependencies: [root] as const,
      derive: ({ get }) => `${get(root)}-derived`,
    });
    const unrelated = defineDataNode({
      key: "unrelated",
      initialValue: "unrelated-initial",
      load: async () => "unrelated-loaded",
    });
    const runtime = createGraphRuntime(
      createGraph({
        nodes: [descendant, unrelated, root],
      }),
    );
    await runtime.execute([descendant, unrelated]);

    runtime.publish(changed, { id: 1 });

    expect(runtime.getState(root)).toMatchObject({
      data: "loaded",
      status: "success",
      freshness: "stale",
      generation: 1,
      hasSuccessfulValue: true,
    });
    expect(runtime.getState(descendant)).toMatchObject({
      data: "loaded-derived",
      status: "success",
      freshness: "stale",
      generation: 1,
      hasSuccessfulValue: true,
    });
    expect(runtime.getState(unrelated)).toMatchObject({
      data: "unrelated-loaded",
      freshness: "fresh",
      generation: 0,
    });
  });

  it("evaluates conditional matches against committed declared dependency values", () => {
    const jobSeekerId = defineContextNode({
      key: "jobSeekerId",
      initialValue: 123,
    });
    const changed = defineEvent<{ jobSeekerId: number }>("domain.changed");
    const data = defineDataNode({
      key: "data",
      dependencies: [jobSeekerId] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({
            payload,
            get,
          }: EventInvalidationContext<typeof changed, readonly [typeof jobSeekerId]>) =>
            payload.jobSeekerId === get(jobSeekerId),
        },
      ] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, jobSeekerId] }));

    runtime.publish(changed, { jobSeekerId: 999 });
    expect(runtime.getState(data).generation).toBe(0);

    runtime.publish(changed, { jobSeekerId: 123 });
    expect(runtime.getState(data).generation).toBe(1);
  });

  it("applies no invalidation when any predicate throws", () => {
    const changed = defineEvent<void>("domain.changed");
    const first = defineDataNode({
      key: "first",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const second = defineDataNode({
      key: "second",
      invalidatedBy: [
        {
          event: changed,
          when: () => {
            throw new Error("predicate failed");
          },
        },
      ] as const,
      initialValue: 0,
      load: async () => 2,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }));

    expect(() => runtime.publish(changed, undefined)).toThrowError("predicate failed");
    expect(runtime.getState(first).generation).toBe(0);
    expect(runtime.getState(second).generation).toBe(0);
  });

  it("reloads subscribed matching nodes through the existing scheduler", async () => {
    const changed = defineEvent<void>("domain.changed");
    const load = vi.fn(async () => load.mock.calls.length);
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    await runtime.prefetch([data]);
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    expect(load).toHaveBeenCalledTimes(1);

    runtime.publish(changed, undefined);
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getState(data)).toMatchObject({
      data: 2,
      freshness: "fresh",
      status: "success",
    });
  });

  it("keeps no-match and unused event publication silent", () => {
    const changed = defineEvent<{ match: boolean }>("domain.changed");
    const unused = defineEvent<void>("domain.unused");
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [
        {
          event: changed,
          when: ({ payload }: EventInvalidationContext<typeof changed, readonly []>) =>
            payload.match,
        },
      ] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    runtime.publish(changed, { match: false });
    runtime.publish(unused, undefined);

    expect(listener).not.toHaveBeenCalled();
    expect(runtime.getState(data).generation).toBe(0);
    expect(runtime.getSchedulerState().isScheduled).toBe(false);
  });

  it("deduplicates shared descendants and emits one committed notification", () => {
    const changed = defineEvent<void>("domain.changed");
    const left = defineDataNode({
      key: "left",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const right = defineDataNode({
      key: "right",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 2,
    });
    const shared = defineDerivedNode({
      key: "shared",
      dependencies: [left, right] as const,
      derive: () => 3,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [shared, right, left] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    runtime.publish(changed, undefined);

    expect(runtime.getState(left).generation).toBe(1);
    expect(runtime.getState(right).generation).toBe(1);
    expect(runtime.getState(shared).generation).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("advances generation before aborting affected work and ignores its late result", async () => {
    const changed = defineEvent<void>("domain.changed");
    const result = deferred<string>();
    let signal: AbortSignal | undefined;
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [changed] as const,
      initialValue: "initial",
      load: ({ signal: attemptSignal }) => {
        signal = attemptSignal;
        return result.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const execution = runtime.execute([data]);
    await waitForCondition(() => signal !== undefined, "event race attempt start");

    runtime.publish(changed, undefined);

    expect(runtime.getState(data).generation).toBe(1);
    expect(signal?.aborted).toBe(true);
    result.resolve("obsolete");
    await execution;
    expect(runtime.getState(data).data).toBe("initial");
    expect(runtime.getState(data).freshness).toBe("stale");
  });
});
