import { describe, expect, it, vi } from "vitest";
import { abortableWork } from "../../src/core/util/abortable-work";
import { deferred } from "./test-helpers";

describe("cancellation of caller-owned work", () => {
  it("does not invoke work after cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("owner ended");
    controller.abort(reason);
    const start = vi.fn(() => 1);
    await expect(abortableWork(controller.signal, start)).rejects.toBe(reason);
    expect(start).not.toHaveBeenCalled();
  });

  it("removes its abort listener when work throws synchronously", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("start failed");
    await expect(
      abortableWork(controller.signal, () => {
        throw reason;
      }),
    ).rejects.toBe(reason);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("observes a late rejection after cancellation without changing the outcome", async () => {
    const controller = new AbortController();
    const remote = deferred<number>();
    const pending = abortableWork(controller.signal, () => remote.promise);
    const reason = new Error("shutdown");
    const rejected = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    remote.reject(new Error("late remote failure"));
    await Promise.resolve();
    await Promise.resolve();
  });
});
