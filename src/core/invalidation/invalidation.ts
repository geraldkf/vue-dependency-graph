import type {
  ActiveAttempt,
  MutableNodeRuntimeState,
} from "../state/state";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  Graph,
} from "../graph/node";
import type { ContextChange } from "../transactions/types";

export interface RuntimeInvalidationController {
  readonly resolveContextNode: <TValue>(
    node: ContextNodeDefinition<TValue>
  ) => ContextNodeDefinition<TValue>;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ) => void;
  readonly commitContexts: (
    changes: readonly ContextChange[]
  ) => void;
  readonly invalidateChangedResultDescendants: (
    node: AnyNodeDefinition
  ) => void;
}

export interface RuntimeInvalidationDependencies {
  readonly graph: Graph;
  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;
  readonly getActiveAttempt: (
    key: string
  ) => ActiveAttempt | undefined;
  readonly hasSubscribers: (
    node: AnyNodeDefinition
  ) => boolean;
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string
  ) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly schedule: () => void;
}

const isContextNode = (
  node: AnyNodeDefinition
): node is ContextNodeDefinition<unknown> =>
  node.kind === "context";

export const createRuntimeInvalidationController = ({
  graph,
  getMutableState,
  getActiveAttempt,
  hasSubscribers,
  resolveRegisteredNode,
  notify,
  schedule,
}: RuntimeInvalidationDependencies): RuntimeInvalidationController => {
  const requireRegisteredContextNode = <TValue>(
    node: ContextNodeDefinition<TValue>
  ): ContextNodeDefinition<TValue> => {
    const registered = resolveRegisteredNode(node, "context update");
    if (!isContextNode(registered)) {
      throw new Error(
        `Context node "${node.key}" is not registered in this graph.`
      );
    }
    return registered as ContextNodeDefinition<TValue>;
  };

  const collectDescendants = (
    nodes: readonly AnyNodeDefinition[]
  ): readonly AnyNodeDefinition[] => {
    const descendants: AnyNodeDefinition[] = [];
    const visited = new Set<string>();
    const queue = nodes.flatMap(node => graph.getChildren(node));

    while (queue.length > 0) {
      const descendant = queue.shift();
      if (!descendant || visited.has(descendant.key)) continue;
      visited.add(descendant.key);
      descendants.push(descendant);
      queue.push(...graph.getChildren(descendant));
    }

    return descendants;
  };

  const invalidateNodes = (
    descendants: readonly AnyNodeDefinition[]
  ): boolean => {
    let subscribedDescendantChanged = false;

    for (const descendant of descendants) {
      const state = getMutableState(descendant.key);
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      state.error = null;

      if (hasSubscribers(descendant)) {
        subscribedDescendantChanged = true;
      }
    }

    for (const descendant of descendants) {
      getActiveAttempt(descendant.key)?.controller.abort();
    }

    return subscribedDescendantChanged;
  };

  const invalidateDescendants = (
    node: AnyNodeDefinition
  ): boolean =>
    invalidateNodes(collectDescendants([node]));

  const commitContexts = (
    changes: readonly ContextChange[]
  ): void => {
    const effectiveChanges = changes.filter(({ node, value }) =>
      !Object.is(getMutableState(node.key).data, value)
    );
    if (effectiveChanges.length === 0) return;

    for (const { node, value } of effectiveChanges) {
      const contextState = getMutableState(node.key);
      contextState.data = value;
      contextState.status = "success";
      contextState.freshness = "fresh";
      contextState.error = null;
      contextState.generation += 1;
      contextState.hasSuccessfulValue = true;
    }

    const descendants = collectDescendants(
      effectiveChanges.map(({ node }) => node)
    );
    const subscribedDescendantChanged = invalidateNodes(descendants);

    notify();
    if (subscribedDescendantChanged) schedule();
  };

  const setContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ): void => {
    const registered = requireRegisteredContextNode(node);
    commitContexts([{
      node: registered as ContextNodeDefinition<unknown>,
      value,
    }]);
  };

  const invalidateChangedResultDescendants = (
    node: AnyNodeDefinition
  ): void => {
    const subscribedDescendantChanged =
      invalidateDescendants(node);
    if (graph.getChildren(node).length > 0) notify();
    if (subscribedDescendantChanged) schedule();
  };

  return Object.freeze({
    resolveContextNode: requireRegisteredContextNode,
    setContext,
    commitContexts,
    invalidateChangedResultDescendants,
  });
};
