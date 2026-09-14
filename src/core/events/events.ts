import type { AnyEventDefinition } from "./event";
import { getEventInvalidationCandidates } from "./event-index";
import type { AnyNodeDefinition, Graph } from "../graph/node";
import type { MutableNodeRuntimeState } from "../state/state";
import type {
  ContextChange,
  EventPublication,
} from "../transactions/types";

export interface RuntimeEventController {
  readonly matchPublications: (
    publications: readonly EventPublication[],
    contextChanges: readonly ContextChange[]
  ) => readonly AnyNodeDefinition[];
}

export interface RuntimeEventControllerDependencies {
  readonly graph: Graph;
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
}

export const createRuntimeEventController = ({
  graph,
  getMutableState,
}: RuntimeEventControllerDependencies): RuntimeEventController => {
  const matchPublications = (
    publications: readonly EventPublication[],
    contextChanges: readonly ContextChange[]
  ): readonly AnyNodeDefinition[] => {
    const contextValues = new Map(
      contextChanges.map(change => [change.node.key, change.value])
    );
    const matchedNodes = new Map<string, AnyNodeDefinition>();

    for (const { event, payload } of publications) {
      for (const candidate of getEventInvalidationCandidates(graph, event)) {
        const dependencyKeys = new Set(
          candidate.node.dependencies.map(dependency => dependency.key)
        );
        const get = (dependency: AnyNodeDefinition): unknown => {
          if (!dependencyKeys.has(dependency.key)) {
            throw new Error(
              `Node "${candidate.node.key}" event predicate cannot read undeclared dependency "${dependency.key}".`
            );
          }

          if (contextValues.has(dependency.key)) {
            return contextValues.get(dependency.key);
          }

          const state = getMutableState(dependency.key);
          if (!state.hasSuccessfulValue) {
            throw new Error(
              `Dependency "${dependency.key}" has no successful value for node "${candidate.node.key}" event predicate.`
            );
          }
          return state.data;
        };

        if (!candidate.when || candidate.when({ payload, get })) {
          matchedNodes.set(candidate.node.key, candidate.node);
        }
      }
    }

    return [...matchedNodes.values()];
  };

  return Object.freeze({ matchPublications });
};
