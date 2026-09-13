# Graph and Node Model

## Definitions and runtime state

Node definitions are immutable typed descriptors. Definitions contain identity, topology, initial values, and retained execution functions. Mutable values, status, errors, generations, subscriptions, and active work belong to a `GraphRuntime`.

A validated graph and its definitions may therefore be shared by multiple independent runtime instances.

## Strongly typed node handles

A node definition is also its typed handle:

```ts
const Credits = defineDataNode({
  key: "credits",
  initialValue: [] as Credit[],
  load: async () => api.getCredits(),
});
```

`NodeValue<typeof Credits>` resolves to `Credit[]`. Consumer APIs normally accept handles and retain their value types. Stable string keys remain the identity used for topology, diagnostics, validation, and future serialisation.

## Node kinds

### Context node

A context node declares a mutable graph input and an initial value:

```ts
const PointPeriodId = defineContextNode<number | undefined>({
  key: "pointPeriodId",
  initialValue: undefined,
});
```

Context definitions have no dependencies. A runtime owns the current context value and applies descendant invalidation when it changes.

### Data node

A data node declares asynchronous work:

```ts
const Targets = defineDataNode({
  key: "targets",
  dependencies: [JobSeekerId, PointPeriodId] as const,
  initialValue: [] as Target[],
  load: ({ get, signal }) =>
    api.getTargets(get(JobSeekerId), get(PointPeriodId), signal),
});
```

The loader's `get` function accepts only declared dependency handles and returns each dependency's value type. The runtime supplies an attempt-scoped `AbortSignal`.

### Derived node

A derived node calculates synchronously from dependencies:

```ts
const CanModifyCredit = defineDerivedNode({
  key: "canModifyCredit",
  dependencies: [Permissions, CurrentCredit] as const,
  derive: ({ get }) =>
    get(Permissions).includes("credit.modify") &&
    get(CurrentCredit)?.status !== "Finalised",
});
```

Asynchronous work belongs in a data node so it shares the runtime's loading, cancellation, error, refresh, and metrics model.

## Forward references

A dependency resolver supports definitions that require forward references:

```ts
const A = defineDerivedNode({
  key: "A",
  dependencies: () => [B] as const,
  derive: () => "A",
});
```

Resolvers are evaluated during graph creation. They must be synchronous, side-effect free, and return stable handles.

## Graph creation

```ts
const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});
```

Registration order does not matter. `createGraph` receives the complete definition set, validates it, builds indexes, and then returns the graph. Dynamic registration is not supported.

## Graph indexes

The graph privately maintains:

- Node by key
- Parent keys by node key
- Child keys by node key

Every registered node is represented, including roots, leaves, and disconnected nodes. Parent order follows dependency declaration order. Children use deterministic key order.

Graph identity is key-based. Duplicate node keys are invalid even when the definitions are otherwise identical.

## Validation

Graph construction rejects:

- Empty or whitespace-only keys
- Duplicate node keys
- Duplicate dependencies in one node
- Dependencies missing from the graph
- Self cycles
- Multi-node cycles
- Cycles in disconnected components

Validation failures use `GraphValidationError` and a narrow `GraphValidationErrorCode` union. Messages identify relevant node keys, and circular-dependency messages include a readable path where practical.

## Topology inspection

```ts
const node = graph.getNode("targets");
const parents = graph.getParents(Targets);
const children = graph.getChildren("pointPeriodId");
const nodes = graph.getNodes();
```

Unknown keys return `undefined` from `getNode`, `false` from `hasNode`, and empty collections from parent or child inspection.

`getNodes` preserves registration order. Returned arrays are frozen copies and cannot mutate internal indexes.

## Runtime relationship

The graph describes valid topology. `GraphRuntime` supplies current values and behaviour on top of it, including:

- Context mutation and descendant invalidation
- Dependency-aware execution
- Subscription-driven scheduling
- Prefetch and refresh
- Vue observation and component lifecycle integration

Runtime behaviour does not mutate graph definitions or topology.
