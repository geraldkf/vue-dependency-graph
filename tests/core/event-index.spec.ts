import { describe, expect, it } from "vitest";
import {
  GraphValidationError,
  createGraph,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  type AnyNodeDefinition,
} from "../../src/core";
import { getEventInvalidationCandidates } from "../../src/core/events/event-index";

const expectEventValidation = (
  action: () => unknown,
  code: GraphValidationError["code"],
  values: readonly string[],
): void => {
  try {
    action();
    throw new Error("Expected graph validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(GraphValidationError);
    expect((error as GraphValidationError).code).toBe(code);
    for (const value of values) {
      expect((error as Error).message).toContain(value);
    }
  }
};

describe("graph event invalidation index", () => {
  it("indexes unconditional and conditional declarations in graph registration order", () => {
    const jobSeekerId = defineContextNode({
      key: "jobSeekerId",
      initialValue: 123,
    });
    const appointmentBooked = defineEvent<{ jobSeekerId: number }>("appointment.booked");
    const first = defineDerivedNode({
      key: "first",
      dependencies: [jobSeekerId] as const,
      invalidatedBy: [appointmentBooked] as const,
      derive: () => "first",
    });
    const when = () => true;
    const second = defineDataNode({
      key: "second",
      dependencies: [jobSeekerId] as const,
      invalidatedBy: [{ event: appointmentBooked, when }] as const,
      initialValue: "",
      load: async () => "second",
    });
    const graph = createGraph({
      nodes: [second, jobSeekerId, first],
    });

    const candidates = getEventInvalidationCandidates(graph, appointmentBooked);

    expect(candidates.map((candidate) => candidate.node.key)).toEqual(["second", "first"]);
    expect(candidates[0]).toMatchObject({
      event: appointmentBooked,
      node: second,
      when,
    });
    expect(candidates[1]).toMatchObject({
      event: appointmentBooked,
      node: first,
      when: undefined,
    });
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(candidates.every(Object.isFrozen)).toBe(true);
  });

  it("resolves equivalent event handles by key and returns an immutable empty result for unused events", () => {
    const declared = defineEvent<{ value: number }>("domain.changed");
    const equivalent = defineEvent<{ value: number }>("domain.changed");
    const unused = defineEvent<void>("domain.unused");
    const node = defineDataNode({
      key: "data",
      invalidatedBy: [declared] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const graph = createGraph({ nodes: [node] });

    expect(
      getEventInvalidationCandidates(graph, equivalent).map((candidate) => candidate.node.key),
    ).toEqual(["data"]);

    const missing = getEventInvalidationCandidates(graph, unused);
    expect(missing).toEqual([]);
    expect(Object.isFrozen(missing)).toBe(true);
  });

  it("keeps event indexes isolated between graphs", () => {
    const event = defineEvent<void>("domain.changed");
    const first = defineDataNode({
      key: "first",
      invalidatedBy: [event] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const second = defineDataNode({
      key: "second",
      invalidatedBy: [event] as const,
      initialValue: 0,
      load: async () => 2,
    });
    const firstGraph = createGraph({ nodes: [first] });
    const secondGraph = createGraph({ nodes: [second] });

    expect(
      getEventInvalidationCandidates(firstGraph, event).map((candidate) => candidate.node.key),
    ).toEqual(["first"]);
    expect(
      getEventInvalidationCandidates(secondGraph, event).map((candidate) => candidate.node.key),
    ).toEqual(["second"]);
  });

  it("rejects duplicate event keys on one node", () => {
    const first = defineEvent<void>("domain.changed");
    const equivalent = defineEvent<void>("domain.changed");
    const node = defineDataNode({
      key: "data",
      invalidatedBy: [first, equivalent] as const,
      initialValue: 0,
      load: async () => 1,
    });

    expectEventValidation(() => createGraph({ nodes: [node] }), "DUPLICATE_EVENT_INVALIDATION", [
      "data",
      "domain.changed",
    ]);
  });

  it("rejects malformed and blank event declarations from untyped input", () => {
    const malformedNode = Object.freeze({
      key: "malformed",
      kind: "data",
      dependencies: Object.freeze([]),
      invalidatedBy: Object.freeze([{ event: { key: "domain.changed" } }]),
      initialValue: 0,
      load: async () => 1,
    }) as unknown as AnyNodeDefinition;
    const blankEventNode = Object.freeze({
      key: "blank-event",
      kind: "data",
      dependencies: Object.freeze([]),
      invalidatedBy: Object.freeze([{ key: "   " }]),
      initialValue: 0,
      load: async () => 1,
    }) as unknown as AnyNodeDefinition;

    expectEventValidation(
      () => createGraph({ nodes: [malformedNode] }),
      "INVALID_EVENT_DECLARATION",
      ["malformed", "domain.changed"],
    );
    expectEventValidation(() => createGraph({ nodes: [blankEventNode] }), "INVALID_EVENT_KEY", [
      "blank-event",
    ]);
  });

  it("rejects event invalidation metadata on context nodes from untyped input", () => {
    const event = defineEvent<void>("domain.changed");
    const context = Object.freeze({
      key: "context",
      kind: "context",
      dependencies: Object.freeze([]),
      invalidatedBy: Object.freeze([event]),
      initialValue: 1,
    }) as unknown as AnyNodeDefinition;

    expectEventValidation(() => createGraph({ nodes: [context] }), "INVALID_EVENT_DECLARATION", [
      "context",
    ]);
  });
});
