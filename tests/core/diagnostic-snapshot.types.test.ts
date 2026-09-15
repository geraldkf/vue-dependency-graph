import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  type GraphDiagnosticSnapshotV1,
} from "../../src/core";

const typed = defineContextNode({
  key: "typed",
  initialValue: { id: 1, secret: "hidden" },
  diagnostics: { value: value => ({ id: value.id }) },
});
const snapshot: GraphDiagnosticSnapshotV1 = createGraphRuntime(
  createGraph({ nodes: [typed] }),
).createDiagnosticSnapshot();
void snapshot;

defineContextNode({
  key: "invalid-redactor",
  // @ts-expect-error redactor input must agree with the node value type
  initialValue: { id: 1 },
  diagnostics: {
    value: (value: string) => value,
  },
});
