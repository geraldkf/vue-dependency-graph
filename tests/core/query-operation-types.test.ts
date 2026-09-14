import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineQuery,
} from "../../src/core";

const context = defineContextNode({
  key: "query-operation-types-context",
  initialValue: 1,
});
const data = defineDataNode({
  key: "query-operation-types-data",
  dependencies: [context] as const,
  initialValue: "",
  load: async () => "loaded",
});
const query = defineQuery({
  key: "query-operation-types",
  nodes: { context, data },
});
const runtime = createGraphRuntime(createGraph({ nodes: [context, data] }));

const prefetchResult: Promise<void> = runtime.prefetchQuery(query);
const refreshResult: Promise<void> = runtime.refreshQuery(query);
void [prefetchResult, refreshResult];

// @ts-expect-error query operations require a query definition
runtime.prefetchQuery(data);
// @ts-expect-error query operations require a query definition
runtime.refreshQuery({ key: "invalid", nodes: { data: "not-a-node" } });
