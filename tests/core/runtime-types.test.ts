import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

const count = defineContextNode({ key: "count", initialValue: 1 });
const data = defineDataNode({
  key: "data",
  dependencies: [count] as const,
  initialValue: "",
  load: async ({ get }) => String(get(count)),
});
const derived = defineDerivedNode({
  key: "derived",
  dependencies: [data] as const,
  derive: ({ get }) => get(data).length,
});
const runtime = createGraphRuntime(createGraph({ nodes: [derived, data, count] }));

const contextValue: number = runtime.getState(count).data;
const dataValue: string = runtime.getState(data).data;
const derivedValue: number | undefined = runtime.getState(derived).data;
void [contextValue, dataValue, derivedValue];

runtime.setContext(count, 2);
// @ts-expect-error context value must match the context node value type
runtime.setContext(count, "2");
// @ts-expect-error data nodes cannot be set as context
runtime.setContext(data, "value");
// @ts-expect-error derived nodes cannot be set as context
runtime.setContext(derived, 2);

void runtime.execute([data, derived] as const);
