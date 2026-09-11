import {
  GraphExecutionError,
  type NodeExecutionFailure,
  isAbortError,
  toError,
} from "./execution";
import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
  Graph,
  NodeValue,
} from "./types";

export type NodeStatus =
  | "idle"
  | "loading"
  | "success"
  | "refreshing"
  | "error";

export type NodeFreshness = "fresh" | "stale";

export type RuntimeNodeData<TNode extends AnyNodeDefinition> =
  TNode["kind"] extends "derived"
    ? NodeValue<TNode> | undefined
    : NodeValue<TNode>;

export interface NodeRuntimeState<TData> {
  readonly data: TData;
  readonly status: NodeStatus;
  readonly freshness: NodeFreshness;
  readonly error: Error | null;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
}

export type RuntimeListener = () => void;

export interface GraphRuntime {
  readonly getState: <TNode extends AnyNodeDefinition>(
    node: TNode
  ) => NodeRuntimeState<RuntimeNodeData<TNode>>;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ) => void;
  readonly execute: (
    nodes: readonly AnyNodeDefinition[]
  ) => Promise<void>;
  readonly subscribe: (listener: RuntimeListener) => () => void;
}

interface MutableNodeRuntimeState {
  data: unknown;
  status: NodeStatus;
  freshness: NodeFreshness;
  error: Error | null;
  generation: number;
  hasSuccessfulValue: boolean;
}

interface ActiveAttempt {
  readonly generation: number;
  readonly token: symbol;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

class NodeAttemptFailure extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly causeError: Error
  ) {
    super(`Node "${nodeKey}" failed.`);
    this.name = "NodeAttemptFailure";
  }
}

class NodeBlockedFailure extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly blockedBy: readonly string[]
  ) {
    super(`Node "${nodeKey}" was blocked by: ${blockedBy.join(", ")}.`);
    this.name = "NodeBlockedFailure";
  }
}

class ObsoleteAttempt extends Error {
  public constructor() {
    super("Execution attempt was aborted or superseded.");
    this.name = "ObsoleteAttempt";
  }
}

const isContextNode = (
  node: AnyNodeDefinition
): node is ContextNodeDefinition<unknown> => node.kind === "context";

const isDataNode = (
  node: AnyNodeDefinition
): node is DataNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "data";

const isDerivedNode = (
  node: AnyNodeDefinition
): node is DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "derived";

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
    data: isDataNode(node) ? node.initialValue : undefined,
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

export const createGraphRuntime = (graph: Graph): GraphRuntime => {
  const states = new Map<string, MutableNodeRuntimeState>();
  const activeAttempts = new Map<string, ActiveAttempt>();
  const listeners = new Set<RuntimeListener>();

  for (const node of graph.getNodes()) {
    states.set(node.key, createInitialState(node));
  }

  const requireState = (key: string): MutableNodeRuntimeState => {
    const state = states.get(key);
    if (!state) throw new Error(`Runtime state for node "${key}" was not found.`);
    return state;
  };

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Listener failures are isolated from runtime state and other listeners.
      }
    }
  };

  const setContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ): void => {
    const registered = graph.getNode(node.key);
    if (!registered || registered.kind !== "context") {
      throw new Error(`Context node "${node.key}" is not registered in this graph.`);
    }

    const contextState = requireState(node.key);
    if (Object.is(contextState.data, value)) return;

    contextState.data = value;
    contextState.status = "success";
    contextState.freshness = "fresh";
    contextState.error = null;
    contextState.generation += 1;
    contextState.hasSuccessfulValue = true;

    const visited = new Set<string>();
    const queue = [...graph.getChildren(node)];
    while (queue.length > 0) {
      const descendant = queue.shift();
      if (!descendant || visited.has(descendant.key)) continue;
      visited.add(descendant.key);

      const state = requireState(descendant.key);
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      state.error = null;

      activeAttempts.get(descendant.key)?.controller.abort();
      queue.push(...graph.getChildren(descendant));
    }

    notify();
  };

  const getDependencyValue = <TNode extends AnyNodeDefinition>(
    dependency: TNode
  ): NodeValue<TNode> => {
    const state = requireState(dependency.key);
    if (!state.hasSuccessfulValue || state.freshness !== "fresh") {
      throw new Error(
        `Dependency "${dependency.key}" does not have a successful fresh value.`
      );
    }
    return state.data as NodeValue<TNode>;
  };

  const executeNode = (node: AnyNodeDefinition): Promise<void> => {
    const state = requireState(node.key);
    if (
      state.hasSuccessfulValue &&
      state.status === "success" &&
      state.freshness === "fresh"
    ) {
      return Promise.resolve();
    }

    const active = activeAttempts.get(node.key);
    if (active?.generation === state.generation) return active.promise;

    if (isContextNode(node)) return Promise.resolve();

    const generation = state.generation;
    const token = Symbol(node.key);
    const controller = new AbortController();

    state.status = state.hasSuccessfulValue ? "refreshing" : "loading";
    state.freshness = "stale";
    state.error = null;
    notify();

    const run = async (): Promise<void> => {
      try {
        let value: unknown;
        if (isDataNode(node)) {
          value = await node.load({
            get: getDependencyValue,
            signal: controller.signal,
          });
        } else if (isDerivedNode(node)) {
          value = node.derive({ get: getDependencyValue });
        } else {
          return;
        }

        const current = states.get(node.key);
        const currentAttempt = activeAttempts.get(node.key);
        if (
          !current ||
          current.generation !== generation ||
          currentAttempt?.token !== token ||
          controller.signal.aborted
        ) {
          throw new ObsoleteAttempt();
        }

        current.data = value;
        current.status = "success";
        current.freshness = "fresh";
        current.error = null;
        current.hasSuccessfulValue = true;
        notify();
      } catch (thrown) {
        const current = states.get(node.key);
        const currentAttempt = activeAttempts.get(node.key);
        const obsolete =
          !current ||
          current.generation !== generation ||
          currentAttempt?.token !== token ||
          controller.signal.aborted ||
          thrown instanceof ObsoleteAttempt ||
          isAbortError(thrown);

        if (obsolete) throw new ObsoleteAttempt();

        const error = toError(thrown);
        current.status = "error";
        current.freshness = "stale";
        current.error = error;
        notify();
        throw new NodeAttemptFailure(node.key, error);
      } finally {
        if (activeAttempts.get(node.key)?.token === token) {
          activeAttempts.delete(node.key);
        }
      }
    };

    const promise = Promise.resolve().then(run);
    activeAttempts.set(node.key, {
      generation,
      token,
      controller,
      promise,
    });
    return promise;
  };

  const execute = async (
    targets: readonly AnyNodeDefinition[]
  ): Promise<void> => {
    if (targets.length === 0) return;

    const failures = new Map<string, NodeExecutionFailure>();
    const requested = new Map<string, Promise<void>>();

    const recordFailure = (failure: NodeExecutionFailure): void => {
      if (!failures.has(failure.nodeKey)) failures.set(failure.nodeKey, failure);
    };

    const ensureNode = (node: AnyNodeDefinition): Promise<void> => {
      const existing = requested.get(node.key);
      if (existing) return existing;

      const promise = (async (): Promise<void> => {
        const parentResults = await Promise.allSettled(
          graph.getParents(node).map(parent => ensureNode(parent))
        );
        if (
          parentResults.some(
            result =>
              result.status === "rejected" &&
              result.reason instanceof ObsoleteAttempt
          )
        ) {
          throw new ObsoleteAttempt();
        }

        const parents = graph.getParents(node);
        const blockedBy = parentResults.flatMap((result, index) =>
          result.status === "rejected"
            ? [parents[index]?.key].filter(
                (key): key is string => key !== undefined
              )
            : []
        );

        if (blockedBy.length > 0) {
          const failure: NodeExecutionFailure = {
            nodeKey: node.key,
            kind: "blocked",
            blockedBy,
          };
          recordFailure(failure);
          throw new NodeBlockedFailure(node.key, blockedBy);
        }

        try {
          await executeNode(node);
        } catch (error) {
          if (error instanceof ObsoleteAttempt) throw error;
          if (error instanceof NodeAttemptFailure) {
            recordFailure({
              nodeKey: node.key,
              kind: "failed",
              error: error.causeError,
            });
          }
          throw error;
        }
      })();

      requested.set(node.key, promise);
      return promise;
    };

    const registeredTargets = targets.map(target => {
      const registered = graph.getNode(target.key);
      if (!registered) {
        throw new Error(`Execution target "${target.key}" is not registered.`);
      }
      return registered;
    });

    await Promise.allSettled(registeredTargets.map(target => ensureNode(target)));

    if (failures.size > 0) {
      throw new GraphExecutionError([...failures.values()]);
    }
  };

  return Object.freeze({
    getState: <TNode extends AnyNodeDefinition>(node: TNode) =>
      snapshotState<RuntimeNodeData<TNode>>(requireState(node.key)),
    setContext,
    execute,
    subscribe: (listener: RuntimeListener) => {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
  });
};
