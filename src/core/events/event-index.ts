import type { AnyEventDefinition } from "./types";
import type { AnyNodeDefinition, Graph } from "../graph/types";

export interface EventInvalidationCandidate {
  readonly event: AnyEventDefinition;
  readonly node: AnyNodeDefinition;
  readonly when: ((context: {
    readonly payload: unknown;
    readonly get: (node: AnyNodeDefinition) => unknown;
  }) => boolean) | undefined;
}

const indexes = new WeakMap<
  Graph,
  ReadonlyMap<string, readonly EventInvalidationCandidate[]>
>();

export const registerEventInvalidationIndex = (
  graph: Graph,
  index: ReadonlyMap<string, readonly EventInvalidationCandidate[]>
): void => {
  indexes.set(graph, index);
};

export const getEventInvalidationCandidates = (
  graph: Graph,
  event: AnyEventDefinition
): readonly EventInvalidationCandidate[] =>
  indexes.get(graph)?.get(event.key) ?? Object.freeze([]);
