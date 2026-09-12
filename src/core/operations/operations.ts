import type { RefreshableNodeDefinition } from "./types";
import type {
  ActiveAttempt,
  MutableNodeRuntimeState,
} from "../state/state";
import type { AnyNodeDefinition } from "../graph/node";

export interface RuntimeOperationsController {
  readonly prefetch: (
    targets: readonly AnyNodeDefinition[]
  ) => Promise<void>;
  readonly refresh: (
    targets: readonly RefreshableNodeDefinition[]
  ) => Promise<void>;
}

export interface RuntimeOperationsDependencies {
  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;
  readonly getActiveAttempt: (
    key: string
  ) => ActiveAttempt | undefined;
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string
  ) => AnyNodeDefinition;
  readonly execute: (
    targets: readonly AnyNodeDefinition[],
    origin: "prefetch" | "refresh"
  ) => Promise<void>;
  readonly notify: () => void;
}

const createRefreshOperationKey = (
  keys: ReadonlySet<string>
): string =>
  JSON.stringify([...keys].sort());

const isRefreshableNode = (
  node: AnyNodeDefinition
): node is RefreshableNodeDefinition =>
  node.kind === "data" || node.kind === "derived";

export const createRuntimeOperationsController = ({
  getMutableState,
  getActiveAttempt,
  resolveRegisteredNode,
  execute,
  notify,
}: RuntimeOperationsDependencies): RuntimeOperationsController => {
  const refreshOperations = new Map<string, Promise<void>>();

  const prefetch = (
    targets: readonly AnyNodeDefinition[]
  ): Promise<void> =>
    execute(targets, "prefetch");

  const refresh = (
    requestedTargets: readonly RefreshableNodeDefinition[]
  ): Promise<void> => {
    if (requestedTargets.length === 0) return Promise.resolve();

    const targets: RefreshableNodeDefinition[] = [];
    const keys = new Set<string>();
    for (const requested of requestedTargets) {
      const registered = resolveRegisteredNode(
        requested,
        "manual refresh"
      );
      if (!isRefreshableNode(registered)) {
        return Promise.reject(
          new Error(
            `Context node "${registered.key}" cannot be refreshed.`
          )
        );
      }
      if (keys.has(registered.key)) continue;
      keys.add(registered.key);
      targets.push(registered);
    }

    const operationKey = createRefreshOperationKey(keys);
    const existing = refreshOperations.get(operationKey);
    if (existing) return existing;

    for (const target of targets) {
      const state = getMutableState(target.key);
      const active = getActiveAttempt(target.key);
      if (active?.origins.has("refresh")) continue;
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      active?.controller.abort();
    }
    notify();

    const operation = execute(targets, "refresh").finally(() => {
      if (refreshOperations.get(operationKey) === operation) {
        refreshOperations.delete(operationKey);
      }
    });
    refreshOperations.set(operationKey, operation);
    return operation;
  };

  return Object.freeze({ prefetch, refresh });
};
