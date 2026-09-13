import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
} from "../../src/core";
import {
  useNode,
  useNodes,
  type GraphComposableOptions,
} from "../../src/vue";

const count = defineContextNode({
  key: "runtime-options:type:count",
  initialValue: 1,
});
const label = defineContextNode({
  key: "runtime-options:type:label",
  initialValue: "label",
});
const runtime = createGraphRuntime(createGraph({ nodes: [count, label] }));
const options: GraphComposableOptions = { runtime };

const countResult = useNode(count, options);
const countValue: number = countResult.data.value;
void countValue;

const query = useNodes([count, label], options);
const queryCount: number = query.results[0].value.data;
const queryLabel: string = query.results[1].value.data;
void [queryCount, queryLabel];

// @ts-expect-error runtime must be a GraphRuntime
useNode(count, { runtime: "not-a-runtime" });

// @ts-expect-error explicit runtime support must not weaken tuple result typing
const wrongType: string = query.results[0].value.data;
void wrongType;
