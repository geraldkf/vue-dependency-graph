import { describe, expect, it, vi } from "vitest";
import {
  GraphMutationConflictError,
  createGraph,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  whenEvent,
  type Graph,
} from "../../src/core";
import {
  getEventInvalidationCandidates,
  registerEventInvalidationIndex,
} from "../../src/core/events/event-index";
import { createRuntimeEventMatcher } from "../../src/core/events/event-matcher";
import { createExecutionConcurrencyLimiter } from "../../src/core/execution/concurrency-limiter";
import { captureMutationContext } from "../../src/core/mutations/mutation-context";
import { createRuntimeStateStore } from "../../src/core/state/state";
import { writeValue } from "../../src/core/state/transitions";
import { createRuntimeSubscriptionController } from "../../src/core/subscriptions/subscriptions";

/** A graph whose lookups are counted, to prove what a code path does and does not walk. */
const spied = (graph: Graph, events: readonly { readonly key: string }[] = []) => {
  const getNodes = vi.fn(graph.getNodes);
  const getParents = vi.fn(graph.getParents);
  const wrapped = { ...graph, getNodes, getParents } as Graph;
  // The event index belongs to the graph object it was built for.
  registerEventInvalidationIndex(
    wrapped,
    new Map(
      events.map((event) => [
        event.key,
        getEventInvalidationCandidates(
          graph,
          event as Parameters<typeof getEventInvalidationCandidates>[1],
        ),
      ]),
    ),
  );
  return { graph: wrapped, getNodes, getParents };
};

describe("mutation context capture", () => {
  const build = () => {
    const a = defineContextNode({ key: "a", initialValue: 0 });
    const b = defineContextNode({ key: "b", initialValue: 0 });
    const target = defineDerivedNode({
      key: "target",
      dependencies: [a],
      derive: ({ get }) => get(a),
    });
    const graph = createGraph({ nodes: [a, b, target] });
    return { a, b, target, graph, states: createRuntimeStateStore(graph) };
  };

  it("does not walk any ancestors when no context changed", () => {
    const { target, graph, states } = build();
    const counted = spied(graph);
    const check = captureMutationContext(counted.graph, states.getNodeState, "save");
    counted.getParents.mockClear();

    check([target]);
    check([target], false);

    expect(counted.getParents).not.toHaveBeenCalled();
  });

  it("finds the context nodes once per graph, however many mutations capture it", () => {
    const { graph, states } = build();
    const counted = spied(graph);

    for (let call = 0; call < 5; call += 1) {
      captureMutationContext(counted.graph, states.getNodeState, "save");
    }

    expect(counted.getNodes).toHaveBeenCalledTimes(1);
  });

  it("still rejects a target whose own context changed", () => {
    const { a, target, graph, states } = build();
    const check = captureMutationContext(graph, states.getNodeState, "save");

    writeValue(states.getNodeState(a.key), 1, "fresh");

    expect(() => check([target], false)).toThrow(GraphMutationConflictError);
  });

  it("ignores a change to a context the target does not depend on", () => {
    const { b, target, graph, states } = build();
    const check = captureMutationContext(graph, states.getNodeState, "save");

    writeValue(states.getNodeState(b.key), 1, "fresh");

    expect(() => check([target])).not.toThrow();
  });
});

describe("concurrency limiter queue", () => {
  it("grants in arrival order after waiters in the middle abort", async () => {
    const limiter = createExecutionConcurrencyLimiter(1);
    const holder = new AbortController();
    await limiter.acquire(holder.signal);
    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const granted: number[] = [];
    const settled = controllers.map((controller, index) =>
      limiter.acquire(controller.signal).then(
        () => {
          granted.push(index);
          limiter.release();
        },
        () => undefined,
      ),
    );

    controllers[1]!.abort();
    controllers[4]!.abort();
    limiter.release();
    await Promise.all(settled);

    expect(granted).toEqual([0, 2, 3, 5]);
  });

  it("handles a very long queue of waiters that all abort", async () => {
    const limiter = createExecutionConcurrencyLimiter(1);
    await limiter.acquire(new AbortController().signal);
    const controllers = Array.from({ length: 20_000 }, () => new AbortController());
    const waiting = controllers.map((controller) =>
      limiter.acquire(controller.signal).then(
        () => "granted",
        () => "aborted",
      ),
    );

    for (const controller of controllers) controller.abort();

    expect(new Set(await Promise.all(waiting))).toEqual(new Set(["aborted"]));
    limiter.release();
    await expect(limiter.acquire(new AbortController().signal)).resolves.toBeUndefined();
  });

  it("passes the slot over a waiter that aborted while queued", async () => {
    const limiter = createExecutionConcurrencyLimiter(1);
    await limiter.acquire(new AbortController().signal);
    const abortedController = new AbortController();
    const liveController = new AbortController();
    const aborted = limiter.acquire(abortedController.signal).catch(() => "aborted");
    const live = limiter.acquire(liveController.signal).then(() => "granted");

    abortedController.abort();
    limiter.release();

    expect(await aborted).toBe("aborted");
    expect(await live).toBe("granted");
  });
});

describe("event matching", () => {
  const Ping = defineEvent<{ readonly ok: boolean }>("ping");

  const build = () => {
    const gate = defineContextNode({ key: "gate", initialValue: true });
    const unconditional = Array.from({ length: 5 }, (_, index) =>
      defineDataNode({
        key: `unconditional:${index}`,
        initialValue: 0,
        invalidatedBy: [Ping],
        load: async () => 1,
      }),
    );
    const conditional = defineDataNode({
      key: "conditional",
      dependencies: [gate],
      initialValue: 0,
      invalidatedBy: [whenEvent(Ping, [gate], ({ payload, get }) => payload.ok && get(gate))],
      load: async () => 1,
    });
    const graph = createGraph({ nodes: [gate, ...unconditional, conditional] });
    const states = createRuntimeStateStore(graph);
    return { gate, unconditional, conditional, graph, states };
  };

  it("matches unconditional candidates without looking at their dependencies", () => {
    const { graph, states, unconditional } = build();
    const counted = spied(graph, [Ping]);
    const matcher = createRuntimeEventMatcher({
      graph: counted.graph,
      getNodeState: states.getNodeState,
    });
    counted.getParents.mockClear();

    const matched = matcher.matchPublications([{ event: Ping, payload: { ok: false } }]);

    expect(matched.map((node) => node.key)).toEqual(unconditional.map((node) => node.key));
    expect(counted.getParents).not.toHaveBeenCalled();
  });

  it("resolves a conditional candidate's dependencies once, across publications", () => {
    const { graph, states, conditional } = build();
    const counted = spied(graph, [Ping]);
    const matcher = createRuntimeEventMatcher({
      graph: counted.graph,
      getNodeState: states.getNodeState,
    });
    counted.getParents.mockClear();

    for (let call = 0; call < 3; call += 1) {
      const matched = matcher.matchPublications([{ event: Ping, payload: { ok: true } }]);
      expect(matched).toContain(conditional);
    }

    expect(counted.getParents).toHaveBeenCalledTimes(1);
  });

  it("still enforces that predicates read only declared dependencies", () => {
    const stranger = defineContextNode({ key: "stranger", initialValue: 0 });
    const gate = defineContextNode({ key: "gate2", initialValue: true });
    const node = defineDataNode({
      key: "reads-undeclared",
      dependencies: [gate],
      initialValue: 0,
      invalidatedBy: [
        whenEvent(Ping, [gate], ({ get }) => {
          (get as (dependency: unknown) => unknown)(stranger);
          return true;
        }),
      ],
      load: async () => 1,
    });
    const graph = createGraph({ nodes: [gate, stranger, node] });
    const matcher = createRuntimeEventMatcher({
      graph,
      getNodeState: createRuntimeStateStore(graph).getNodeState,
    });

    expect(() => matcher.matchPublications([{ event: Ping, payload: { ok: true } }])).toThrow(
      /undeclared dependency "stranger"/,
    );
  });
});

describe("subscription inspection", () => {
  const build = () => {
    const root = defineContextNode({ key: "root", initialValue: 0 });
    const leaf = defineDerivedNode({
      key: "leaf",
      dependencies: [root],
      derive: ({ get }) => get(root),
    });
    const graph = createGraph({ nodes: [root, leaf] });
    const controller = createRuntimeSubscriptionController({
      graph,
      resolveRegisteredNode: (node) => {
        if (!graph.hasNode(node.key)) throw new Error(`Node "${node.key}" is not registered.`);
        return node;
      },
      notify: () => undefined,
      afterSubscribe: () => undefined,
      afterUnsubscribe: () => undefined,
    });
    return { root, leaf, controller };
  };

  it("agrees with the subscription state for direct, required and absent demand", () => {
    const { root, leaf, controller } = build();
    expect(controller.hasSubscribers(root)).toBe(false);
    expect(controller.hasSubscribers(leaf)).toBe(false);

    const subscription = controller.subscribeNodes([leaf]);

    for (const node of [root, leaf]) {
      expect(controller.hasSubscribers(node)).toBe(controller.getSubscriptionState(node).total > 0);
      expect(controller.hasSubscribers(node)).toBe(true);
    }

    subscription.unsubscribe();
    expect(controller.hasSubscribers(root)).toBe(false);
    expect(controller.hasSubscribers(leaf)).toBe(false);
  });

  it("rejects a node that is not registered", () => {
    const { controller } = build();
    const stranger = defineContextNode({ key: "stranger", initialValue: 0 });

    expect(() => controller.hasSubscribers(stranger)).toThrow(/not registered/);
  });
});
