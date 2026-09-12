import type {
  ActiveAttempt,
  MutableNodeRuntimeState,
} from "../state/state";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  Graph,
} from "../graph/node";

export interface RuntimeInvalidationController {
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
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

  const invalidateDescendants = (
    node: AnyNodeDefinition
  ): boolean => {
    const visited = new Set<string>();
    const queue = [...graph.getChildren(node)];
    let subscribedDescendantChanged = false;

    while (queue.length > 0) {
      const descendant = queue.shift();
      if (!descendant || visited.has(descendant.key)) continue;
      visited.add(descendant.key);

      const state = getMutableState(descendant.key);
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      state.error = null;
      getActiveAttempt(descendant.key)?.controller.abort();

      if (hasSubscribers(descendant)) {
        subscribedDescendantChanged = true;
      }
      queue.push(...graph.getChildren(descendant));
    }

    return subscribedDescendantChanged;
  };

  const setContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ): void => {
    const registered = requireRegisteredContextNode(node);
    const contextState = getMutableState(registered.key);
    if (Object.is(contextState.data, value)) return;

    contextState.data = value;
    contextState.status = "success";
    contextState.freshness = "fresh";
    contextState.error = null;
    contextState.generation += 1;
    contextState.hasSuccessfulValue = true;

    const subscribedDescendantChanged =
      invalidateDescendants(registered);
    notify();
    if (subscribedDescendantChanged) schedule();
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
    setContext,
    invalidateChangedResultDescendants,
  });
};
