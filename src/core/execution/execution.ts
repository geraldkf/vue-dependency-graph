import type { ExecutionConcurrencyLimiter } from "./concurrency-limiter";
import {
  GraphExecutionError,
  type NodeExecutionFailure,
  isAbortError,
  toError,
} from "./types";
import type {
  ActiveAttempt,
  ExecutionOrigin,
  MutableNodeRuntimeState,
} from "../state/state";
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
  Graph,
  NodeValue,
} from "../graph/node";

export interface RuntimeExecutionController {
  readonly execute: (
    targets: readonly AnyNodeDefinition[],
    origin: ExecutionOrigin
  ) => Promise<void>;
  readonly needsExecution: (node: AnyNodeDefinition) => boolean;
}

export interface RuntimeExecutionDependencies {
  readonly graph: Graph;
  readonly concurrencyLimiter: ExecutionConcurrencyLimiter;
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
  readonly getActiveAttempt: (key: string) => ActiveAttempt | undefined;
  readonly setActiveAttempt: (key: string, attempt: ActiveAttempt) => void;
  readonly deleteActiveAttempt: (key: string, token: symbol) => void;
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition
  ) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly onChangedRefreshResult: (
    node: AnyNodeDefinition
  ) => void;
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

const isDataNode = (
  node: AnyNodeDefinition
): node is DataNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "data";

const isDerivedNode = (
  node: AnyNodeDefinition
): node is DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "derived";

const hasFreshSuccessfulValue = (
  state: MutableNodeRuntimeState
): boolean =>
  state.hasSuccessfulValue &&
  state.status === "success" &&
  state.freshness === "fresh";

export const createRuntimeExecutionController = ({
  graph,
  concurrencyLimiter,
  getMutableState,
  getActiveAttempt,
  setActiveAttempt,
  deleteActiveAttempt,
  resolveRegisteredNode,
  notify,
  onChangedRefreshResult,
}: RuntimeExecutionDependencies): RuntimeExecutionController => {
  const getDependencyValue = <TNode extends AnyNodeDefinition>(
    dependency: TNode
  ): NodeValue<TNode> => {
    const state = getMutableState(dependency.key);
    if (!state.hasSuccessfulValue || state.freshness !== "fresh") {
      throw new Error(
        `Dependency "${dependency.key}" does not have a successful fresh value.`
      );
    }
    return state.data as NodeValue<TNode>;
  };

  const executeNode = (
    node: AnyNodeDefinition,
    origin: ExecutionOrigin
  ): Promise<void> => {
    const state = getMutableState(node.key);
    if (hasFreshSuccessfulValue(state)) return Promise.resolve();

    const active = getActiveAttempt(node.key);
    if (active?.generation === state.generation) {
      active.origins.add(origin);
      return active.promise;
    }

    if (node.kind === "context") return Promise.resolve();

    const generation = state.generation;
    const previousData = state.data;
    const hadSuccessfulValue = state.hasSuccessfulValue;
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
          await concurrencyLimiter.acquire(controller.signal);
          try {
            value = await node.load({
              get: getDependencyValue,
              signal: controller.signal,
            });
          } finally {
            concurrencyLimiter.release();
          }
        } else if (isDerivedNode(node)) {
          value = node.derive({ get: getDependencyValue });
        } else {
          return;
        }

        const current = getMutableState(node.key);
        const currentAttempt = getActiveAttempt(node.key);
        if (
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

        if (
          currentAttempt.origins.has("refresh") &&
          hadSuccessfulValue &&
          !Object.is(previousData, value)
        ) {
          onChangedRefreshResult(node);
        }
      } catch (thrown) {
        const current = getMutableState(node.key);
        const currentAttempt = getActiveAttempt(node.key);
        const obsolete =
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
        deleteActiveAttempt(node.key, token);
      }
    };

    const promise = Promise.resolve().then(run);
    setActiveAttempt(node.key, {
      generation,
      token,
      controller,
      origins: new Set([origin]),
      promise,
    });
    return promise;
  };

  const execute = async (
    targets: readonly AnyNodeDefinition[],
    origin: ExecutionOrigin
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
          await executeNode(node, origin);
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

    const registeredTargets = targets.map(resolveRegisteredNode);
    await Promise.allSettled(registeredTargets.map(target => ensureNode(target)));

    if (failures.size > 0) {
      throw new GraphExecutionError([...failures.values()]);
    }
  };

  const needsExecution = (node: AnyNodeDefinition): boolean =>
    !hasFreshSuccessfulValue(getMutableState(node.key));

  return Object.freeze({ execute, needsExecution });
};
