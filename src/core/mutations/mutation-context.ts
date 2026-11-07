import type { AnyNodeDefinition, Graph } from "../graph/types";
import type { NodeStateRecord } from "../state/state";
import { GraphMutationConflictError, GraphMutationReconciliationError } from "./errors";

const contextNodesByGraph = new WeakMap<Graph, readonly AnyNodeDefinition[]>();

/** A graph never changes, so its context nodes are found once. */
const getContextNodes = (graph: Graph): readonly AnyNodeDefinition[] => {
  let contextNodes = contextNodesByGraph.get(graph);
  if (!contextNodes) {
    contextNodes = graph.getNodes().filter((node) => node.kind === "context");
    contextNodesByGraph.set(graph, contextNodes);
  }
  return contextNodes;
};

/** Captures identity before remote work, without rejecting newer work for the same context. */
export const captureMutationContext = (
  graph: Graph,
  getNodeState: (key: string) => NodeStateRecord,
  mutationKey: string,
): ((nodes: readonly AnyNodeDefinition[], remoteSucceeded?: boolean) => void) => {
  const generations = new Map(
    getContextNodes(graph).map((node) => [node.key, getNodeState(node.key).generation]),
  );
  const anyContextChanged = (): boolean => {
    for (const [key, generation] of generations) {
      if (getNodeState(key).generation !== generation) return true;
    }
    return false;
  };
  return (nodes, remoteSucceeded = true) => {
    // The common case: no context changed, so no target can be affected and
    // there is no need to walk any target's ancestors.
    if (!anyContextChanged()) return;
    const changedTargets = nodes.filter((node) => {
      const visited = new Set<string>();
      const queue = [...graph.getParents(node)];
      for (let index = 0; index < queue.length; index += 1) {
        const parent = queue[index]!;
        if (visited.has(parent.key)) continue;
        visited.add(parent.key);
        if (
          parent.kind === "context" &&
          generations.get(parent.key) !== getNodeState(parent.key).generation
        )
          return true;
        queue.push(...graph.getParents(parent));
      }
      return false;
    });
    if (changedTargets.length > 0) {
      if (!remoteSucceeded) {
        throw new GraphMutationConflictError(
          changedTargets.map((node) => node.key),
          "Optimistic mutation context changed before its update could commit.",
        );
      }
      throw new GraphMutationReconciliationError(
        mutationKey,
        changedTargets.map((node) => node.key),
        new Error("Mutation update context changed while remote work was pending."),
      );
    }
  };
};
