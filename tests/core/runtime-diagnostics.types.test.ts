import {
  createGraph,
  createGraphRuntime,
  type GraphDiagnosticEvent,
  type GraphDiagnosticSink,
  type GraphDiagnosticsEnvironment,
  type GraphDiagnosticsOptions,
} from "../../src/core";

const environment: GraphDiagnosticsEnvironment = {
  now: () => 0,
  createRuntimeId: () => "runtime",
};
const sink: GraphDiagnosticSink = {
  emit: (event: GraphDiagnosticEvent) => {
    const sequence: number = event.sequence;
    const runtimeId: string = event.runtimeId;
    void [sequence, runtimeId];
  },
};
const diagnostics: GraphDiagnosticsOptions = { sink, environment };

createGraphRuntime(createGraph({ nodes: [] }), { diagnostics });
createGraphRuntime(createGraph({ nodes: [] }), { diagnostics: {} });

// @ts-expect-error diagnostics must use the structured options shape
createGraphRuntime(createGraph({ nodes: [] }), { diagnostics: sink });

const invalidEnvironment: GraphDiagnosticsEnvironment = {
  // @ts-expect-error diagnostic timestamps must be numeric
  now: () => "now",
  createRuntimeId: () => "runtime",
};
void invalidEnvironment;
