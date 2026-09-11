import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

const context = defineContextNode({ key: "context", initialValue: 1 });
const data = defineDataNode({ key: "data", initialValue: "", load: async () => "value" });
const derived = defineDerivedNode({ key: "derived", dependencies: [context] as const, derive: () => true });
const runtime = createGraphRuntime(createGraph({ nodes: [derived, data, context] }));

const subscription = runtime.subscribeNodes([context, data, derived] as const);
const direct: number = runtime.getSubscriptionState(context).direct;
const subscribed: boolean = runtime.hasSubscribers(derived);
void [direct, subscribed];

// @ts-expect-error subscription nodes are read-only
subscription.nodes.push(context);
// @ts-expect-error subscription state properties are read-only
runtime.getSubscriptionState(data).direct = 2;
// @ts-expect-error public subscription inspection uses typed handles, not strings
runtime.getSubscriptionState("data");
// @ts-expect-error public node subscription uses typed handles, not strings
runtime.subscribeNodes(["data"]);


// @ts-expect-error old demand registration API was removed
runtime.addDemand([data]);
// @ts-expect-error old demand inspection API was removed
runtime.getDemandState(data);
// @ts-expect-error old demand predicate API was removed
runtime.hasDemand(data);
// @ts-expect-error runtime change observation was renamed to onChange
runtime.subscribe(() => undefined);
