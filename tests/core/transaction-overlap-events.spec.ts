import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineEvent,
  GraphTransactionConflictError,
  normalizeDiagnosticEvents,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

interface EventCompletionCase {
  readonly committedLabel: "first" | "second";
  readonly committedEventKey: string;
  readonly committedTargetKey: string;
  readonly rolledBackEventKey: string;
  readonly rolledBackTargetKey: string;
}

describe("overlapping transaction event isolation", () => {
  it.each([
    {
      committedLabel: "second",
      committedEventKey: "overlap-events.second",
      committedTargetKey: "overlap-events-second-target",
      rolledBackEventKey: "overlap-events.first",
      rolledBackTargetKey: "overlap-events-first-target",
    },
    {
      committedLabel: "first",
      committedEventKey: "overlap-events.first",
      committedTargetKey: "overlap-events-first-target",
      rolledBackEventKey: "overlap-events.second",
      rolledBackTargetKey: "overlap-events-second-target",
    },
  ] as const)(
    "commits the $committedLabel event session before an independent session rolls back",
    async ({
      committedLabel,
      committedEventKey,
      committedTargetKey,
      rolledBackEventKey,
      rolledBackTargetKey,
    }: EventCompletionCase) => {
      const firstEvent = defineEvent<void>("overlap-events.first");
      const secondEvent = defineEvent<void>("overlap-events.second");
      const firstLoad = vi.fn(async () => 1);
      const secondLoad = vi.fn(async () => 2);
      const firstTarget = defineDataNode({
        key: "overlap-events-first-target",
        invalidatedBy: [firstEvent] as const,
        initialValue: 0,
        load: firstLoad,
      });
      const secondTarget = defineDataNode({
        key: "overlap-events-second-target",
        invalidatedBy: [secondEvent] as const,
        initialValue: 0,
        load: secondLoad,
      });
      const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
      let now = 0;
      const runtime = createGraphRuntime(
        createGraph({ nodes: [firstTarget, secondTarget] }),
        {
          diagnostics: {
            sink: diagnostics,
            environment: {
              now: () => ++now,
              createRuntimeId: () => "overlap-event-runtime",
            },
          },
        },
      );
      const subscription = runtime.subscribeNodes([firstTarget, secondTarget]);
      await runtime.whenSettled();
      firstLoad.mockClear();
      secondLoad.mockClear();
      diagnostics.reset();
      const listener = vi.fn();
      runtime.onChange(listener);
      const releaseFirst = deferred<void>();
      const releaseSecond = deferred<void>();

      const firstTransaction = runtime.transaction(async transaction => {
        transaction.publish(firstEvent, undefined);
        await releaseFirst.promise;
        if (committedLabel !== "first") throw new Error("first rollback");
      });
      const secondTransaction = runtime.transaction(async transaction => {
        transaction.publish(secondEvent, undefined);
        await releaseSecond.promise;
        if (committedLabel !== "second") throw new Error("second rollback");
      });
      await Promise.resolve();

      if (committedLabel === "first") releaseFirst.resolve();
      else releaseSecond.resolve();
      await (committedLabel === "first" ? firstTransaction : secondTransaction);

      await waitForCondition(
        () => (committedLabel === "first" ? firstLoad : secondLoad).mock.calls.length === 1,
        "committed event session reload to start",
      );
      await runtime.whenSettled();

      expect(listener).toHaveBeenCalled();
      expect(runtime.getState(
        committedLabel === "first" ? firstTarget : secondTarget,
      )).toMatchObject({ generation: 1, freshness: "fresh" });
      expect(runtime.getState(
        committedLabel === "first" ? secondTarget : firstTarget,
      )).toMatchObject({ generation: 0, freshness: "fresh" });

      if (committedLabel === "first") releaseSecond.resolve();
      else releaseFirst.resolve();
      await expect(
        committedLabel === "first" ? secondTransaction : firstTransaction,
      ).rejects.toThrow("rollback");

      expect(firstLoad).toHaveBeenCalledTimes(committedLabel === "first" ? 1 : 0);
      expect(secondLoad).toHaveBeenCalledTimes(committedLabel === "second" ? 1 : 0);

      const events = normalizeDiagnosticEvents(diagnostics.getEvents());
      const committedPublication = events.find(event =>
        event.type === "event.published" &&
        "eventKey" in event &&
        event.eventKey === committedEventKey
      );
      expect(committedPublication).toMatchObject({ transactionOwned: true });
      expect(events.some(event =>
        event.type === "event.published" &&
        "eventKey" in event &&
        event.eventKey === rolledBackEventKey
      )).toBe(false);
      expect(events.find(event =>
        event.type === "node.load.started" &&
        event.nodeKey === committedTargetKey
      )).toMatchObject({ causeId: committedPublication?.operationId });
      expect(events.some(event =>
        event.type === "node.load.started" &&
        event.nodeKey === rolledBackTargetKey
      )).toBe(false);

      subscription.unsubscribe();
    },
  );

  it("isolates a predicate exception from another event session", async () => {
    const failingEvent = defineEvent<void>("overlap-events.predicate-failure");
    const successfulEvent = defineEvent<void>("overlap-events.predicate-success");
    const predicate = vi.fn(() => {
      throw new Error("predicate failed");
    });
    const failingTarget = defineDataNode({
      key: "overlap-events-predicate-failure-target",
      invalidatedBy: [{ event: failingEvent, when: predicate }] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const successfulLoad = vi.fn(async () => 2);
    const successfulTarget = defineDataNode({
      key: "overlap-events-predicate-success-target",
      invalidatedBy: [successfulEvent] as const,
      initialValue: 0,
      load: successfulLoad,
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 100 });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [failingTarget, successfulTarget] }),
      { diagnostics: { sink: diagnostics } },
    );
    const subscription = runtime.subscribeNodes([successfulTarget]);
    await runtime.whenSettled();
    successfulLoad.mockClear();
    diagnostics.reset();
    const releaseFailure = deferred<void>();

    const failingTransaction = runtime.transaction(async transaction => {
      transaction.publish(failingEvent, undefined);
      await releaseFailure.promise;
    });
    await Promise.resolve();

    await runtime.transaction(transaction => {
      transaction.publish(successfulEvent, undefined);
    });
    await runtime.whenSettled();

    expect(successfulLoad).toHaveBeenCalledTimes(1);
    expect(runtime.getState(successfulTarget)).toMatchObject({
      generation: 1,
      freshness: "fresh",
      data: 2,
    });
    expect(runtime.getState(failingTarget).generation).toBe(0);

    releaseFailure.resolve();
    await expect(failingTransaction).rejects.toThrow("predicate failed");
    expect(predicate).toHaveBeenCalledTimes(1);
    expect(runtime.getState(successfulTarget).generation).toBe(1);
    expect(runtime.getState(failingTarget).generation).toBe(0);

    const events = normalizeDiagnosticEvents(diagnostics.getEvents());
    expect(events.some(event =>
      event.type === "event.published" &&
      "eventKey" in event &&
      event.eventKey === "overlap-events.predicate-success"
    )).toBe(true);
    expect(events.some(event =>
      event.type === "event.published" &&
      "eventKey" in event &&
      event.eventKey === "overlap-events.predicate-failure"
    )).toBe(false);
    expect(events.some(event => event.type === "transaction.rolled-back")).toBe(true);

    subscription.unsubscribe();
  });

  it("applies neither context nor event work from a conflicted mixed session", async () => {
    const shared = defineContextNode({ key: "overlap-events-mixed-shared", initialValue: 1 });
    const rejectedOnly = defineContextNode({
      key: "overlap-events-mixed-rejected-only",
      initialValue: 10,
    });
    const committedOnly = defineContextNode({
      key: "overlap-events-mixed-committed-only",
      initialValue: 100,
    });
    const rejectedEvent = defineEvent<void>("overlap-events.mixed-rejected");
    const committedEvent = defineEvent<void>("overlap-events.mixed-committed");
    const rejectedTarget = defineDataNode({
      key: "overlap-events-mixed-rejected-target",
      invalidatedBy: [rejectedEvent] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const committedTarget = defineDataNode({
      key: "overlap-events-mixed-committed-target",
      invalidatedBy: [committedEvent] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({
      nodes: [
        shared,
        rejectedOnly,
        committedOnly,
        rejectedTarget,
        committedTarget,
      ],
    }));
    const releaseRejected = deferred<void>();

    const rejectedTransaction = runtime.transaction(async transaction => {
      transaction.setContext(shared, 2);
      transaction.setContext(rejectedOnly, 20);
      transaction.publish(rejectedEvent, undefined);
      await releaseRejected.promise;
    });
    await Promise.resolve();

    await runtime.transaction(transaction => {
      transaction.setContext(shared, 3);
      transaction.setContext(committedOnly, 200);
      transaction.publish(committedEvent, undefined);
    });
    releaseRejected.resolve();
    await expect(rejectedTransaction).rejects.toThrow(GraphTransactionConflictError);

    expect(runtime.getState(shared).data).toBe(3);
    expect(runtime.getState(committedOnly).data).toBe(200);
    expect(runtime.getState(rejectedOnly).data).toBe(10);
    expect(runtime.getState(committedTarget).generation).toBe(1);
    expect(runtime.getState(rejectedTarget).generation).toBe(0);
  });
});
