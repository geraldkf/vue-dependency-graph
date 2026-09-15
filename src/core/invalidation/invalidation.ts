import type {
  ActiveAttempt,
  MutableNodeRuntimeState,
} from "../state/state";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  Graph,
} from "../graph/types";
import type { ContextChange } from "../transactions/types";

export interface InvalidationDispatch {
  readonly notify: () => void;
  readonly schedule: () => void;
}

export interface CombinedInvalidationPlan {
  readonly affectedNodes: readonly AnyNodeDefinition[];
  readonly affectedPreservedKeys: ReadonlySet<string>;
  readonly hasAffectedNodes: boolean;
  readonly subscribedNodeChanged: boolean;
  readonly commit: () => void;
}

export interface RuntimeInvalidationController {
  readonly resolveContextNode: <TValue>(
    node: ContextNodeDefinition<TValue>
  ) => ContextNodeDefinition<TValue>;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ) => void;
  readonly commitContexts: (
    changes: readonly ContextChange[],
    invalidationRoots?: readonly AnyNodeDefinition[],
    dispatch?: InvalidationDispatch
  ) => void;
  readonly invalidateChangedResultDescendants: (
    node: AnyNodeDefinition
  ) => void;
  readonly invalidateChangedResultDescendantsWithoutDispatch: (
    nodes: readonly AnyNodeDefinition[]
  ) => boolean;
  readonly prepareCombinedInvalidation: (
    changedResultRoots: readonly AnyNodeDefinition[],
    invalidationRoots: readonly AnyNodeDefinition[],
    preservedRoots: readonly AnyNodeDefinition[]
  ) => CombinedInvalidationPlan;
  readonly invalidateNodesAndDescendants: (
    nodes: readonly AnyNodeDefinition[]
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
  readonly onContextsCommitted?: (
    contextKeys: readonly string[],
    affectedNodeKeys: readonly string[],
    scheduled: boolean,
  ) => void;
  readonly onChangedResultInvalidated?: (
    rootNodeKeys: readonly string[],
    affectedNodeKeys: readonly string[],
    scheduled: boolean,
  ) => void;
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
  onContextsCommitted,
  onChangedResultInvalidated,
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

    for (let index = 0; index < queue.length; index += 1) {
      const descendant = queue[index];
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

  const collectNodesAndDescendants = (
    nodes: readonly AnyNodeDefinition[]
  ): readonly AnyNodeDefinition[] => {
    const affected = new Map<string, AnyNodeDefinition>();
    for (const node of nodes) affected.set(node.key, node);
    for (const descendant of collectDescendants(nodes)) {
      affected.set(descendant.key, descendant);
    }
    return [...affected.values()];
  };

  const invalidateChangedResultDescendantsWithoutDispatch = (
    nodes: readonly AnyNodeDefinition[]
  ): boolean => {
    const changedKeys = new Set(nodes.map(node => node.key));
    return invalidateNodes(
      collectDescendants(nodes).filter(node => !changedKeys.has(node.key))
    );
  };

  const prepareCombinedInvalidation = (
    changedResultRoots: readonly AnyNodeDefinition[],
    invalidationRoots: readonly AnyNodeDefinition[],
    preservedRoots: readonly AnyNodeDefinition[]
  ): CombinedInvalidationPlan => {
    const affected = new Map<string, AnyNodeDefinition>();
    for (const node of collectDescendants(changedResultRoots)) {
      affected.set(node.key, node);
    }
    for (const node of collectNodesAndDescendants(invalidationRoots)) {
      affected.set(node.key, node);
    }

    const preservedKeys = new Set(preservedRoots.map(node => node.key));
    const affectedPreservedKeys = new Set<string>();
    const nodesToInvalidate: AnyNodeDefinition[] = [];
    let subscribedNodeChanged = false;

    for (const node of affected.values()) {
      if (hasSubscribers(node)) subscribedNodeChanged = true;
      if (preservedKeys.has(node.key)) {
        affectedPreservedKeys.add(node.key);
      } else {
        nodesToInvalidate.push(node);
      }
    }

    return Object.freeze({
      affectedNodes: Object.freeze([...affected.values()]),
      affectedPreservedKeys: Object.freeze(affectedPreservedKeys),
      hasAffectedNodes: affected.size > 0,
      subscribedNodeChanged,
      commit: () => {
        invalidateNodes(nodesToInvalidate);
      },
    });
  };

  const invalidateNodesAndDescendants = (
    nodes: readonly AnyNodeDefinition[]
  ): void => {
    if (nodes.length === 0) return;

    const subscribedNodeChanged = invalidateNodes(
      collectNodesAndDescendants(nodes)
    );
    notify();
    if (subscribedNodeChanged) schedule();
  };

  const commitContexts = (
    changes: readonly ContextChange[],
    invalidationRoots: readonly AnyNodeDefinition[] = [],
    dispatch: InvalidationDispatch = { notify, schedule }
  ): void => {
    const effectiveChanges = changes.filter(({ node, value }) =>
      !Object.is(getMutableState(node.key).data, value)
    );
    if (effectiveChanges.length === 0 && invalidationRoots.length === 0) {
      return;
    }

    for (const { node, value } of effectiveChanges) {
      const contextState = getMutableState(node.key);
      contextState.data = value;
      contextState.status = "success";
      contextState.freshness = "fresh";
      contextState.error = null;
      contextState.generation += 1;
      contextState.hasSuccessfulValue = true;
    }

    const affected = new Map<string, AnyNodeDefinition>();
    for (const descendant of collectDescendants(
      effectiveChanges.map(({ node }) => node)
    )) {
      affected.set(descendant.key, descendant);
    }
    for (const node of collectNodesAndDescendants(invalidationRoots)) {
      affected.set(node.key, node);
    }

    const affectedNodes = [...affected.values()];
    const subscribedNodeChanged = invalidateNodes(affectedNodes);

    onContextsCommitted?.(
      effectiveChanges.map(({ node }) => node.key),
      affectedNodes.map((node) => node.key),
      subscribedNodeChanged,
    );
    dispatch.notify();
    if (subscribedNodeChanged) dispatch.schedule();
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
    const affectedNodeKeys = onChangedResultInvalidated
      ? collectDescendants([node]).map((descendant) => descendant.key)
      : undefined;
    const subscribedDescendantChanged =
      invalidateChangedResultDescendantsWithoutDispatch([node]);
    if (graph.getChildren(node).length > 0) {
      if (affectedNodeKeys) {
        onChangedResultInvalidated?.(
          [node.key],
          affectedNodeKeys,
          subscribedDescendantChanged,
        );
      }
      notify();
    }
    if (subscribedDescendantChanged) schedule();
  };

  return Object.freeze({
    resolveContextNode: requireRegisteredContextNode,
    setContext,
    commitContexts,
    invalidateChangedResultDescendants,
    invalidateChangedResultDescendantsWithoutDispatch,
    prepareCombinedInvalidation,
    invalidateNodesAndDescendants,
  });
};
