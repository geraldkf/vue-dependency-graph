import { getEventInvalidationCandidates } from "./event-index";
import type { AnyNodeDefinition, Graph } from "../graph/types";
import type { NodeStateRecord } from "../state/state";
import type { EventPublication } from "../transactions/types";
import { EventPredicateDependencyError } from "./errors";

export interface EventValueOverlay {
  readonly node: AnyNodeDefinition;
  readonly value: unknown;
}

export interface EventMatchOptions {
  readonly valueOverlay?: readonly EventValueOverlay[];
  readonly prohibitedDependencyKeys?: ReadonlySet<string>;
}

export interface RuntimeEventMatcher {
  readonly matchPublications: (
    publications: readonly EventPublication[],
    options?: EventMatchOptions,
  ) => readonly AnyNodeDefinition[];
}

export interface RuntimeEventMatcherDependencies {
  readonly graph: Graph;
  readonly getNodeState: (key: string) => NodeStateRecord;
}

export const createRuntimeEventMatcher = ({
  graph,
  getNodeState,
}: RuntimeEventMatcherDependencies): RuntimeEventMatcher => {
  // Topology comes from the graph, which resolved each node's dependencies
  // once at creation; never from the node definition. Built on first use,
  // and only for nodes with a conditional predicate.
  const dependencyKeysByNode = new Map<string, ReadonlySet<string>>();
  const getDependencyKeys = (node: AnyNodeDefinition): ReadonlySet<string> => {
    let keys = dependencyKeysByNode.get(node.key);
    if (!keys) {
      keys = new Set(graph.getParents(node).map((dependency) => dependency.key));
      dependencyKeysByNode.set(node.key, keys);
    }
    return keys;
  };

  const matchPublications = (
    publications: readonly EventPublication[],
    options?: EventMatchOptions,
  ): readonly AnyNodeDefinition[] => {
    const overlayValues = new Map(
      (options?.valueOverlay ?? []).map((change) => [change.node.key, change.value]),
    );
    const matchedNodes = new Map<string, AnyNodeDefinition>();

    for (const { event, payload } of publications) {
      for (const candidate of getEventInvalidationCandidates(graph, event)) {
        // An unconditional candidate matches without running any code.
        if (!candidate.when) {
          matchedNodes.set(candidate.node.key, candidate.node);
          continue;
        }

        const get = (dependency: AnyNodeDefinition): unknown => {
          if (!getDependencyKeys(candidate.node).has(dependency.key)) {
            throw new Error(
              `Node "${candidate.node.key}" event predicate cannot read undeclared dependency "${dependency.key}".`,
            );
          }

          if (options?.prohibitedDependencyKeys?.has(dependency.key)) {
            throw new EventPredicateDependencyError(candidate.node.key, dependency.key);
          }

          if (overlayValues.has(dependency.key)) {
            return overlayValues.get(dependency.key);
          }

          const state = getNodeState(dependency.key);
          if (!state.hasSuccessfulValue) {
            throw new Error(
              `Dependency "${dependency.key}" has no successful value for node "${candidate.node.key}" event predicate.`,
            );
          }
          return state.data;
        };

        if (candidate.when({ payload, get })) {
          matchedNodes.set(candidate.node.key, candidate.node);
        }
      }
    }

    return [...matchedNodes.values()];
  };

  return Object.freeze({ matchPublications });
};
