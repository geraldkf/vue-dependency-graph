# Graph and Node Model

## Registry first

Node definitions are immutable descriptors. Runtime state will be stored separately inside a graph instance in a later milestone. Definitions can therefore be reused in tests without carrying status, data, errors, subscribers, or execution state.

## Strongly typed node handles

A node definition is also its typed handle.

```ts
const Credits = defineDataNode({
  key: "credits",
  initialValue: [] as Credit[],
  load: async () => api.getCredits(),
});
```

The handle carries the output type. `NodeValue<typeof Credits>` resolves to `Credit[]`, and later APIs such as `get(Credits)` and `useNode(Credits)` can retain that type.

Keys remain stable string identifiers for topology, diagnostics, serialisation, duplicate detection, and future snapshots. Consumer APIs should normally use handles rather than unrelated string constants.

## Node kinds

### Context node

A mutable graph input in future milestones. Milestone 1 defines only its immutable descriptor and initial value.

```ts
const PointPeriodId = defineContextNode<number | undefined>({
  key: "pointPeriodId",
  initialValue: undefined,
});
```

Context nodes have no dependencies. Nodes should declare each context they require directly.

### Data node

An asynchronous data definition. Its loader is retained but not executed by the registry.

```ts
const Targets = defineDataNode({
  key: "targets",
  dependencies: [JobSeekerId, PointPeriodId] as const,
  initialValue: [] as Target[],
  load: ({ get, signal }) =>
    api.getTargets(get(JobSeekerId), get(PointPeriodId), signal),
});
```

The loader's `get` function accepts only declared dependencies and returns each dependency's value type.

### Derived node

A synchronous calculation from dependencies. Its derive function is retained but not executed by the registry.

```ts
const CanModifyCredit = defineDerivedNode({
  key: "canModifyCredit",
  dependencies: [Permissions, CurrentCredit] as const,
  derive: ({ get }) =>
    get(Permissions).includes("credit.modify") &&
    get(CurrentCredit)?.status !== "Finalised",
});
```

Asynchronous derived nodes remain out of scope. Async work belongs in a data node so future loading, cancellation, errors, polling, and metrics use one model.

## Forward and circular references

Normal definitions use a readonly dependency tuple. A dependency resolver is also supported for definitions that require forward references:

```ts
const A = defineDerivedNode({
  key: "A",
  dependencies: () => [B] as const,
  derive: () => "A",
});
```

Resolvers are evaluated during graph creation, after all local variables should have been initialised. This enables deterministic cycle validation without mutable definitions. They must be synchronous, side-effect free, and return stable handles.

## Graph creation

```ts
const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});
```

Registration order does not matter. `createGraph` receives the complete definition set, validates it, builds all indexes, and only then returns a graph.

Dynamic registration is not supported in the initial design.

## Graph indexes

The graph maintains private indexes:

- Node by key
- Parent keys by node key
- Child keys by node key

Every registered node is represented, including roots, leaves, and disconnected nodes. Duplicate edges are rejected rather than silently deduplicated.

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

Validation failures use `GraphValidationError` and a narrow `GraphValidationErrorCode` union. Messages include relevant node keys, and circular dependency messages include a readable path where practical.

## Topology inspection

The graph exposes read-only inspection:

```ts
const node = graph.getNode("targets");
const parents = graph.getParents(Targets);
const children = graph.getChildren("pointPeriodId");
const nodes = graph.getNodes();
```

Unknown keys return `undefined` from `getNode`, `false` from `hasNode`, and empty collections from parent or child inspection.

`getNodes` preserves registration order. Parent order preserves dependency declaration order. Children use deterministic key order. Returned arrays are frozen copies and cannot mutate internal indexes.

## Deferred runtime concerns

Milestone 1 does not implement:

- Current values
- Status or freshness
- Execution
- Dependency-value resolution
- Scheduling or subscription
- Context mutation
- Invalidation
- Events or transactions
- Metrics or snapshots
