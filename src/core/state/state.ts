import type {
  NodeFreshness,
  NodeRuntimeState,
  NodeStatus,
  RuntimeNodeData,
} from "./types";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  DataNodeDefinition,
  Graph,
} from "../graph/types";

export interface MutableNodeRuntimeState {
  data: unknown;
  status: NodeStatus;
  freshness: NodeFreshness;
  error: Error | null;
  generation: number;
  hasSuccessfulValue: boolean;
}

export type ExecutionOrigin =
  | "explicit"
  | "scheduler"
  | "prefetch"
  | "refresh"
  | "refresh-policy";

export interface ActiveAttempt {
  readonly generation: number;
  readonly token: symbol;
  readonly controller: AbortController;
  readonly origins: Set<ExecutionOrigin>;
  readonly promise: Promise<void>;
}

export interface RuntimeStateStore {
  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;

  readonly getSnapshot: <TNode extends AnyNodeDefinition>(
    node: TNode
  ) => NodeRuntimeState<RuntimeNodeData<TNode>>;

  readonly getActiveAttempt: (
    key: string
  ) => ActiveAttempt | undefined;

  readonly setActiveAttempt: (
    key: string,
    attempt: ActiveAttempt
  ) => void;

  readonly deleteActiveAttempt: (
    key: string,
    token: symbol
  ) => void;

  readonly getActiveAttempts: () =>
    IterableIterator<[string, ActiveAttempt]>;
}

const isContextNode = (
  node: AnyNodeDefinition
): node is ContextNodeDefinition<unknown> =>
  node.kind === "context";

const isDataNode = (
  node: AnyNodeDefinition
): node is DataNodeDefinition<
  unknown,
  readonly AnyNodeDefinition[]
> =>
  node.kind === "data";

const createInitialState = (
  node: AnyNodeDefinition
): MutableNodeRuntimeState => {
  if (isContextNode(node)) {
    return {
      data: node.initialValue,
      status: "success",
      freshness: "fresh",
      error: null,
      generation: 0,
      hasSuccessfulValue: true,
    };
  }

  return {
    data: isDataNode(node)
      ? node.initialValue
      : undefined,
    status: "idle",
    freshness: "stale",
    error: null,
    generation: 0,
    hasSuccessfulValue: false,
  };
};

const snapshotState = <TData>(
  state: MutableNodeRuntimeState
): NodeRuntimeState<TData> =>
  Object.freeze({
    data: state.data as TData,
    status: state.status,
    freshness: state.freshness,
    error: state.error,
    generation: state.generation,
    hasSuccessfulValue: state.hasSuccessfulValue,
  });

export const createRuntimeStateStore = (
  graph: Graph
): RuntimeStateStore => {
  const states =
    new Map<string, MutableNodeRuntimeState>();

  const activeAttempts =
    new Map<string, ActiveAttempt>();

  for (const node of graph.getNodes()) {
    states.set(node.key, createInitialState(node));
  }

  const getMutableState = (
    key: string
  ): MutableNodeRuntimeState => {
    const state = states.get(key);

    if (!state) {
      throw new Error(
        `Runtime state for node "${key}" was not found.`
      );
    }

    return state;
  };

  const getSnapshot = <
    TNode extends AnyNodeDefinition,
  >(
    node: TNode
  ): NodeRuntimeState<RuntimeNodeData<TNode>> =>
    snapshotState<RuntimeNodeData<TNode>>(
      getMutableState(node.key)
    );

  const getActiveAttempt = (
    key: string
  ): ActiveAttempt | undefined =>
    activeAttempts.get(key);

  const setActiveAttempt = (
    key: string,
    attempt: ActiveAttempt
  ): void => {
    activeAttempts.set(key, attempt);
  };

  const deleteActiveAttempt = (
    key: string,
    token: symbol
  ): void => {
    if (activeAttempts.get(key)?.token === token) {
      activeAttempts.delete(key);
    }
  };

  const getActiveAttempts = ():
    IterableIterator<[string, ActiveAttempt]> =>
    activeAttempts.entries();

  return Object.freeze({
    getMutableState,
    getSnapshot,
    getActiveAttempt,
    setActiveAttempt,
    deleteActiveAttempt,
    getActiveAttempts,
  });
};