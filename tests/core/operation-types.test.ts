import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
} from "../../src/core";

const context = defineContextNode({ key: "context", initialValue: 1 });
const data = defineDataNode({ key: "data", initialValue: "", load: async () => "loaded" });
const derived = defineDerivedNode({ key: "derived", dependencies: [data] as const, derive: ({ get }) => get(data).length });
const runtime = createGraphRuntime(createGraph({ nodes: [derived, data, context] }));

const prefetch: Promise<void> = runtime.prefetch([context, data, derived] as const);
const refresh: Promise<void> = runtime.refresh([data, derived] as const);
void [prefetch, refresh];

// @ts-expect-error context nodes cannot be refreshed
runtime.refresh([context]);
// @ts-expect-error prefetch accepts handles, not string keys
runtime.prefetch(["data"]);
// @ts-expect-error refresh accepts handles, not string keys
runtime.refresh(["data"]);


const changed = defineEvent<{ id: number }>("domain.changed");
runtime.publish(changed, { id: 1 });
// @ts-expect-error publish payload must match the selected event
runtime.publish(changed, { id: "invalid" });
