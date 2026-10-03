import type { RuntimeDiagnosticEmitter } from "../diagnostics/diagnostic-emitter";
import type { GraphDiagnosticRefreshPolicySnapshot } from "../diagnostics/snapshot";
import type { Graph } from "../graph/types";
import type { RuntimeListener } from "../observation/types";
import { failAttempt } from "../state/transitions";
import type { RuntimeOperationsController } from "../operations/operations";
import {
  createRuntimeRefreshPolicyController,
  type RuntimeRefreshPolicyDependencies,
} from "../refresh-policies/policy-controller";
import {
  createRuntimeReleasePolicyController,
  type RuntimeReleasePolicyDependencies,
} from "../release-policies/policy-controller";
import { createDefaultTimerEnvironment, type TimerEnvironment } from "../timer-environment";

export interface RuntimePolicyServicesDependencies {
  readonly graph: Graph;
  readonly diagnostics: RuntimeDiagnosticEmitter;
  /** The runtime's `timerEnvironment` option; the default is created here. */
  readonly timerEnvironment: TimerEnvironment | undefined;
  /** The runtime's `releaseAfterMs` option. */
  readonly releaseAfterMs: number | undefined;
  readonly getNodeState: RuntimeRefreshPolicyDependencies["getNodeState"];
  readonly hasSubscribers: RuntimeRefreshPolicyDependencies["hasSubscribers"];
  readonly refreshPolicyNode: RuntimeOperationsController["refreshPolicyNode"];
  readonly notify: RuntimeReleasePolicyDependencies["notify"];
  readonly onChange: (listener: RuntimeListener) => () => void;
}

export interface RuntimePolicyServices {
  readonly getRefreshPolicyDiagnosticSnapshot: () => readonly GraphDiagnosticRefreshPolicySnapshot[];
  /** Detaches both change hooks, then stops both controllers. Idempotent. */
  readonly dispose: () => void;
}

/**
 * Builds the runtime's background policies - refresh (`refreshInterval`,
 * `pollUntil`, retry) and release (a duration, or `Infinity`) - and hooks both
 * to the runtime's change notifications.
 *
 * Ordering is significant and preserved from the original inline wiring: the
 * refresh controller is created and hooked before the release controller, so
 * refresh reconciles before release on every change. Both share the one timer
 * environment. The caller emits `runtime.created` *after* this returns.
 *
 * The policies only observe (`getNodeState`, `hasSubscribers`) and act
 * through the two runtime-owned verbs they are handed: `refreshPolicyNode`
 * and, for a failed policy refresh, the error transition below.
 */
export const createRuntimePolicyServices = ({
  graph,
  diagnostics,
  timerEnvironment,
  releaseAfterMs,
  getNodeState,
  hasSubscribers,
  refreshPolicyNode,
  notify,
  onChange,
}: RuntimePolicyServicesDependencies): RuntimePolicyServices => {
  const environment = timerEnvironment ?? createDefaultTimerEnvironment();

  const refreshPolicies = createRuntimeRefreshPolicyController({
    graph,
    environment,
    getNodeState,
    hasSubscribers,
    refreshPolicyNode: (node) => {
      const operationId = diagnostics.createOperationId();
      return refreshPolicyNode(node, {
        operationId,
        reason: "refresh-policy",
      });
    },
    failPolicyNode: (node, generation, error) => {
      const state = getNodeState(node.key);
      if (state.generation !== generation) return;
      failAttempt(state, error);
      notify();
    },
    onDiagnostic: (type, node, details) => {
      const operationId = diagnostics.createOperationId();
      const eventType = `refresh-policy.${type}` as
        | "refresh-policy.scheduled"
        | "refresh-policy.started"
        | "refresh-policy.retry-scheduled"
        | "refresh-policy.completed"
        | "refresh-policy.failed"
        | "refresh-policy.paused"
        | "refresh-policy.resumed"
        | "refresh-policy.stopped";
      diagnostics.emit({
        type: eventType,
        operationId,
        ...(node === undefined
          ? {}
          : {
              nodeKey: node.key,
              ...(node.refresh === undefined ? {} : { policyKind: node.refresh.kind }),
            }),
        ...(details?.delayMs === undefined ? {} : { delayMs: details.delayMs }),
        ...(details?.error === undefined ? {} : { error: diagnostics.toError(details.error) }),
      });
    },
  });
  const stopRefreshPolicyReconcile = onChange(refreshPolicies.reconcile);

  const releasePolicies = createRuntimeReleasePolicyController({
    graph,
    environment,
    getNodeState,
    hasSubscribers,
    defaultDurationMs: releaseAfterMs,
    notify,
    onDiagnostic: (nodeKey, idleMs) => {
      diagnostics.emit({
        type: "node.value-released",
        operationId: diagnostics.createOperationId(),
        nodeKey,
        idleMs,
      });
    },
  });
  const stopReleasePolicyReconcile = onChange(releasePolicies.reconcile);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    // Detach the change hooks first so nothing can re-arm a timer, then stop
    // the controllers, which clear the timers they already hold.
    stopRefreshPolicyReconcile();
    stopReleasePolicyReconcile();
    refreshPolicies.dispose();
    releasePolicies.dispose();
  };

  return Object.freeze({
    getRefreshPolicyDiagnosticSnapshot: refreshPolicies.getDiagnosticSnapshot,
    dispose,
  });
};
