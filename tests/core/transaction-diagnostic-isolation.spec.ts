import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineEvent,
  normalizeDiagnosticEvents,
} from "../../src/core";
import { deferred } from "./test-helpers";

describe("transaction diagnostic isolation", () => {
  it("keeps causal diagnostics with the owning session when overlapping transactions commit in reverse start order", async () => {
    const firstEvent = defineEvent<void>("transaction.first.changed");
    const secondEvent = defineEvent<void>("transaction.second.changed");
    const firstContext = defineContextNode({
      key: "transaction-first-context",
      initialValue: 1,
    });
    const secondContext = defineContextNode({
      key: "transaction-second-context",
      initialValue: 10,
    });
    const firstData = defineDataNode({
      key: "transaction-first-data",
      dependencies: [firstContext] as const,
      invalidatedBy: [firstEvent] as const,
      initialValue: 0,
      load: async ({ get }) => get(firstContext),
    });
    const secondData = defineDataNode({
      key: "transaction-second-data",
      dependencies: [secondContext] as const,
      invalidatedBy: [secondEvent] as const,
      initialValue: 0,
      load: async ({ get }) => get(secondContext),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    let now = 0;
    const runtime = createGraphRuntime(
      createGraph({
        nodes: [firstData, secondData, firstContext, secondContext],
      }),
      {
        diagnostics: {
          sink: diagnostics,
          environment: {
            now: () => ++now,
            createRuntimeId: () => "transaction-diagnostic-runtime",
          },
        },
      },
    );
    const subscription = runtime.subscribeNodes([firstData, secondData]);
    await runtime.whenSettled();
    diagnostics.reset();
    const releaseFirst = deferred<void>();

    const firstTransaction = runtime.transaction(async transaction => {
      transaction.setContext(firstContext, 2);
      transaction.publish(firstEvent, undefined);
      await releaseFirst.promise;
    });
    await Promise.resolve();

    await runtime.transaction(transaction => {
      transaction.setContext(secondContext, 20);
      transaction.publish(secondEvent, undefined);
    });
    await runtime.whenSettled();

    releaseFirst.resolve();
    await firstTransaction;
    await runtime.whenSettled();
    subscription.unsubscribe();

    const events = normalizeDiagnosticEvents(diagnostics.getEvents());
    const started = events.filter(event => event.type === "transaction.started");
    expect(started).toHaveLength(2);
    const firstOperationId = started[0]?.operationId;
    const secondOperationId = started[1]?.operationId;
    expect(firstOperationId).toBeDefined();
    expect(secondOperationId).toBeDefined();
    expect(firstOperationId).not.toBe(secondOperationId);

    expect(events.find(event =>
      event.type === "context.changed" &&
      event.contextKeys.includes("transaction-first-context")
    )).toMatchObject({ operationId: firstOperationId });
    expect(events.find(event =>
      event.type === "context.changed" &&
      event.contextKeys.includes("transaction-second-context")
    )).toMatchObject({ operationId: secondOperationId });

    expect(events.find(event =>
      event.type === "event.published" &&
      "eventKey" in event &&
      event.eventKey === "transaction.first.changed"
    )).toMatchObject({ operationId: firstOperationId, transactionOwned: true });
    expect(events.find(event =>
      event.type === "event.published" &&
      "eventKey" in event &&
      event.eventKey === "transaction.second.changed"
    )).toMatchObject({ operationId: secondOperationId, transactionOwned: true });

    expect(events.find(event =>
      event.type === "transaction.committed" &&
      event.operationId === firstOperationId
    )).toBeDefined();
    expect(events.find(event =>
      event.type === "transaction.committed" &&
      event.operationId === secondOperationId
    )).toBeDefined();

    for (const [nodeKey, causeId] of [
      ["transaction-first-data", firstOperationId],
      ["transaction-second-data", secondOperationId],
    ] as const) {
      const load = events.find(event =>
        event.type === "node.load.started" && event.nodeKey === nodeKey
      );
      expect(load).toMatchObject({ causeId });
      const scheduler = events.find(event =>
        event.type === "scheduler.started" &&
        event.operationId === load?.operationId
      );
      expect(scheduler).toMatchObject({ causeId });
    }
  });
  it("does not let a rolled-back session alter another session's diagnostic chain", async () => {
    const rolledBackContext = defineContextNode({
      key: "transaction-rolled-back-context",
      initialValue: 1,
    });
    const committedContext = defineContextNode({
      key: "transaction-committed-context",
      initialValue: 10,
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 100 });
    let now = 0;
    const runtime = createGraphRuntime(
      createGraph({ nodes: [rolledBackContext, committedContext] }),
      {
        diagnostics: {
          sink: diagnostics,
          environment: {
            now: () => ++now,
            createRuntimeId: () => "transaction-rollback-diagnostic-runtime",
          },
        },
      },
    );
    const releaseRollback = deferred<void>();

    const rolledBackTransaction = runtime.transaction(async transaction => {
      transaction.setContext(rolledBackContext, 2);
      await releaseRollback.promise;
      throw new Error("rollback");
    });
    await Promise.resolve();

    await runtime.transaction(transaction => {
      transaction.setContext(committedContext, 20);
    });

    releaseRollback.resolve();
    await expect(rolledBackTransaction).rejects.toThrow("rollback");

    const events = normalizeDiagnosticEvents(diagnostics.getEvents());
    const started = events.filter(event => event.type === "transaction.started");
    const rolledBackOperationId = started[0]?.operationId;
    const committedOperationId = started[1]?.operationId;

    expect(events.find(event =>
      event.type === "context.changed" &&
      event.contextKeys.includes("transaction-committed-context")
    )).toMatchObject({ operationId: committedOperationId });
    expect(events.some(event =>
      event.type === "context.changed" &&
      event.operationId === rolledBackOperationId
    )).toBe(false);
    expect(events.find(event =>
      event.type === "transaction.rolled-back" &&
      event.operationId === rolledBackOperationId
    )).toBeDefined();
    expect(events.find(event =>
      event.type === "transaction.committed" &&
      event.operationId === committedOperationId
    )).toBeDefined();
  });

});
