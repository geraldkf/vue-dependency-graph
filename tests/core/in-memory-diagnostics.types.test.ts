import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  type GraphDiagnosticEvent,
  type GraphMetricsSnapshot,
  type InMemoryGraphDiagnostics,
} from "../../src/core";

const diagnostics: InMemoryGraphDiagnostics = createInMemoryGraphDiagnostics({
  capacity: 100,
});
const events: readonly GraphDiagnosticEvent[] = diagnostics.getEvents();
const metrics: GraphMetricsSnapshot = diagnostics.getMetrics();
createGraphRuntime(createGraph({ nodes: [] }), {
  diagnostics: { sink: diagnostics },
});
void [events, metrics];

// @ts-expect-error capacity is required
createInMemoryGraphDiagnostics({});
// @ts-expect-error capacity must be numeric
createInMemoryGraphDiagnostics({ capacity: "100" });
