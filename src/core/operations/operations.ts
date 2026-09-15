import type { RefreshableNodeDefinition } from "./types";
import type { ExecutionDiagnosticContext } from "../execution/execution";
import type {
  ActiveAttempt,
  MutableNodeRuntimeState,
} from "../state/state";
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
} from "../graph/types";
import type { ExecutionOrigin } from "../state/state";

export interface RuntimeOperationsController {
  readonly prefetch: (
    targets: readonly AnyNodeDefinition[],
    diagnostics?: ExecutionDiagnosticContext,
  ) => Promise<void>;
  readonly refresh: (
    targets: readonly RefreshableNodeDefinition[],
    diagnostics?: ExecutionDiagnosticContext,
  ) => Promise<void>;
  readonly refreshPolicyNode: (
    node: DataNodeDefinition<unknown, readonly AnyNodeDefinition[]>,
    diagnostics?: ExecutionDiagnosticContext,
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
    origin: "prefetch" | "refresh" | "refresh-policy",
    diagnostics?: ExecutionDiagnosticContext,
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
    targets: readonly AnyNodeDefinition[],
    diagnostics?: ExecutionDiagnosticContext,
  ): Promise<void> => execute(targets, "prefetch", diagnostics);

  const refreshWithOrigin = (
    requestedTargets: readonly RefreshableNodeDefinition[],
    origin: Extract<ExecutionOrigin, "refresh" | "refresh-policy">,
    purpose: string,
    diagnostics?: ExecutionDiagnosticContext,
  ): Promise<void> => {
    if (requestedTargets.length === 0) return Promise.resolve();

    const targets: RefreshableNodeDefinition[] = [];
    const keys = new Set<string>();
    for (const requested of requestedTargets) {
      const registered = resolveRegisteredNode(requested, purpose);
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
    if (existing) {
      for (const target of targets) {
        getActiveAttempt(target.key)?.origins.add(origin);
      }
      return existing;
    }

    for (const target of targets) {
      const state = getMutableState(target.key);
      const active = getActiveAttempt(target.key);
      if (
        active?.origins.has("refresh") ||
        active?.origins.has("refresh-policy")
      ) {
        active.origins.add(origin);
        continue;
      }
      state.generation += 1;
      state.freshness = "stale";
      state.status = state.hasSuccessfulValue ? "success" : "idle";
      active?.controller.abort();
    }
    notify();

    const operation = execute(targets, origin, diagnostics).finally(() => {
      if (refreshOperations.get(operationKey) === operation) {
        refreshOperations.delete(operationKey);
      }
    });
    refreshOperations.set(operationKey, operation);
    return operation;
  };

  const refresh = (
    targets: readonly RefreshableNodeDefinition[],
    diagnostics?: ExecutionDiagnosticContext,
  ): Promise<void> => refreshWithOrigin(
    targets,
    "refresh",
    "manual refresh",
    diagnostics,
  );

  const refreshPolicyNode = (
    node: DataNodeDefinition<unknown, readonly AnyNodeDefinition[]>,
    diagnostics?: ExecutionDiagnosticContext,
  ): Promise<void> =>
    refreshWithOrigin(
      [node],
      "refresh-policy",
      "refresh policy",
      diagnostics,
    );

  return Object.freeze({ prefetch, refresh, refreshPolicyNode });
};
