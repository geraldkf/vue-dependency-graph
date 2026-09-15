import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineEvent,
  defineMutation,
  staleAfter,
  type GraphDiagnosticEvent,
  type RefreshPolicyEnvironment,
} from "../../src/core";

const createDiagnostics = () => {
  const events: GraphDiagnosticEvent[] = [];
  let now = 0;
  return {
    events,
    options: {
      sink: { emit: (event: GraphDiagnosticEvent) => events.push(event) },
      environment: {
        now: () => ++now,
        createRuntimeId: () => "advanced",
      },
    },
  };
};

describe("advanced runtime diagnostics", () => {
  it("records transaction commit and rollback without exposing staged values", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }), {
      diagnostics: diagnostics.options,
    });

    await runtime.transaction(transaction => {
      transaction.setContext(context, 2);
    });
    await expect(runtime.transaction(transaction => {
      transaction.setContext(context, 3);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");

    expect(diagnostics.events.some(
      event => event.type === "transaction.committed",
    )).toBe(true);
    expect(diagnostics.events.find(
      event => event.type === "transaction.rolled-back",
    )).toMatchObject({ error: { name: "Error", message: "rollback" } });
    expect(JSON.stringify(diagnostics.events)).not.toContain('"value":2');
    expect(JSON.stringify(diagnostics.events)).not.toContain('"value":3');
  });

  it("records immediate and transaction-owned event publication without payloads", async () => {
    const changed = defineEvent<{ readonly secret: string }>("domain.changed");
    const node = defineDataNode({
      key: "event-target",
      initialValue: 0,
      load: async () => 1,
      invalidatedBy: [changed],
    });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      diagnostics: diagnostics.options,
    });

    runtime.publish(changed, { secret: "sensitive" });
    await runtime.transaction(transaction => {
      transaction.publish(changed, { secret: "transaction-sensitive" });
    });

    const published = diagnostics.events.filter(
      (event): event is Extract<GraphDiagnosticEvent, { readonly eventKey: string }> =>
        event.type === "event.published" && "eventKey" in event,
    );
    expect(published).toHaveLength(2);
    expect(published.map(event => event.transactionOwned)).toEqual([false, true]);
    expect(published.every(event => event.eventKey === "domain.changed")).toBe(true);
    expect(JSON.stringify(published)).not.toContain("sensitive");
  });

  it("records successful and rejected mutation terminal outcomes without input or result values", async () => {
    const success = defineMutation({
      key: "save.success",
      execute: async ({ input }: { readonly input: { readonly secret: string }; readonly signal: AbortSignal }) => ({ id: 1, echo: input.secret }),
    });
    const rejection = new Error("rejected");
    const failure = defineMutation({
      key: "save.failure",
      execute: async () => Promise.reject(rejection),
    });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [] }), {
      diagnostics: diagnostics.options,
    });

    await runtime.mutate(success, { secret: "input-secret" });
    await expect(runtime.mutate(failure, undefined)).rejects.toBe(rejection);

    expect(diagnostics.events.find(
      event =>
        event.type === "mutation.completed" &&
        "mutationKey" in event &&
        event.mutationKey === "save.success",
    )).toMatchObject({ outcome: "succeeded" });
    expect(diagnostics.events.find(
      event =>
        event.type === "mutation.completed" &&
        "mutationKey" in event &&
        event.mutationKey === "save.failure",
    )).toMatchObject({ outcome: "rejected" });
    const mutationEvents = diagnostics.events.filter(
      event => event.type.startsWith("mutation."),
    );
    expect(JSON.stringify(mutationEvents)).not.toContain("input-secret");
    expect(JSON.stringify(mutationEvents)).not.toContain('"echo"');
  });

  it("records refresh-policy scheduling and execution", async () => {
    let now = 0;
    let nextTimerId = 1;
    const timers = new Map<number, () => void>();
    const environment: RefreshPolicyEnvironment = {
      now: () => now,
      setTimeout: (callback) => {
        const id = nextTimerId++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: handle => {
        if (typeof handle === "number") timers.delete(handle);
      },
      random: () => 0.5,
      isPaused: () => false,
      onPauseChange: () => () => undefined,
    };
    const node = defineDataNode({
      key: "policy-node",
      initialValue: 0,
      load: async () => 1,
      refresh: staleAfter({ durationMs: 100 }),
    });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      diagnostics: diagnostics.options,
      refreshPolicyEnvironment: environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(diagnostics.events.find(
      event => event.type === "refresh-policy.scheduled",
    )).toMatchObject({
      nodeKey: "policy-node",
      policyKind: "stale-after",
      delayMs: 100,
    });

    now = 100;
    const timer = [...timers.values()][0];
    timer?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(diagnostics.events.some(
      event => event.type === "refresh-policy.started",
    )).toBe(true);
    subscription.unsubscribe();
  });
});
