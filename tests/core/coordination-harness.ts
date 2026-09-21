import {
  createGraph,
  createInMemoryGraphDiagnostics,
  type AnyNodeDefinition,
  type GraphDiagnosticEvent,
} from "../../src/core";
import { createGraphCoordination } from "../../src/core/composition/graph-coordination";
import { createRuntimeDiagnosticEmitter } from "../../src/core/diagnostics/diagnostic-emitter";
import { createOperationObservationTracker } from "../../src/core/diagnostics/operation-observation";
import { createRuntimeObserver } from "../../src/core/observation/observer";
import { createSchedulerRequestTracker } from "../../src/core/scheduling/request-tracker";
import { createRuntimeStateStore } from "../../src/core/state/state";

/**
 * Builds the execution, scheduler, subscription and invalidation controllers
 * without a full runtime, so tests can look at internals the public API does
 * not expose (the active attempt table, for example).
 */
export const buildCoordination = (
  nodes: readonly AnyNodeDefinition[],
  options?: { readonly maxConcurrentLoads?: number },
) => {
  const graph = createGraph({ nodes });
  const collector = createInMemoryGraphDiagnostics({ capacity: 500 });
  const diagnostics = createRuntimeDiagnosticEmitter({ sink: collector });
  const state = createRuntimeStateStore(graph);
  const observer = createRuntimeObserver();
  const schedulerRequest = createSchedulerRequestTracker("subscription");
  const operationObservation = createOperationObservationTracker();
  const coordination = createGraphCoordination({
    graph,
    diagnostics,
    getNodeState: state.getNodeState,
    getActiveAttempt: state.getActiveAttempt,
    setActiveAttempt: state.setActiveAttempt,
    deleteActiveAttempt: state.deleteActiveAttempt,
    getActiveAttempts: state.getActiveAttempts,
    notify: observer.notify,
    requireRegisteredNode: (node, purpose) => {
      const registered = graph.getNode(node.key);
      if (!registered) {
        throw new Error(`"${node.key}" not registered for ${purpose}`);
      }
      return registered;
    },
    schedulerRequest,
    operationObservation,
    maxConcurrentLoads: options?.maxConcurrentLoads,
  });
  return {
    coordination,
    state,
    metrics: () => collector.getMetrics(),
    events: (): readonly GraphDiagnosticEvent[] => collector.getEvents(),
  };
};
