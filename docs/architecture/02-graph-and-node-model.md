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

## Refresh policy metadata

Data-node definitions may carry one immutable refresh policy created by `staleAfter(...)`, `refreshInterval(...)`, or `pollUntil<TValue>(...)`. The policy is graph metadata only; a runtime's refresh-policy controller owns the actual timers, retry counters, pause state, and polling sessions built on top of that metadata (Milestone 8, complete - see `docs/architecture/03-scheduler-transactions-and-concurrency.md`).

Context and derived nodes cannot declare refresh policies. Graph creation defensively validates policy metadata but does not evaluate polling predicates or create runtime activity.

## Release policy metadata

Data-node definitions may carry one immutable release policy created by `releaseAfter(...)`, or opt out of the runtime's default with `retain()` (Milestone 12, complete - see [ADR-016](../decisions/ADR-016-value-release-policies.md)). Like refresh policies, this is graph metadata only - a runtime's release-policy controller owns the timer that decides when an idle node's value actually gets reset (`docs/architecture/03-scheduler-transactions-and-concurrency.md`). Context and derived nodes cannot declare a release policy: a context value is caller-provided input, not cache, and derived nodes are cheap enough to recompute that releasing them wasn't part of this milestone's scope.

## Forward references

A dependency resolver supports definitions that require forward references:

```ts
const A = defineDerivedNode({
  key: "A",
  dependencies: () => [B] as const,
  derive: () => "A",
});
```

Resolvers are not called when a node is defined (that would break forward references). A resolver is called on the first read of the node's `dependencies` - normally during graph creation - and its result is frozen and reused, so it runs once and every consumer sees the same array. A resolver that throws is not cached; the next read tries again. Resolvers must be synchronous, side-effect free, and return the same handles for the lifetime of the definition. A plain dependency array is copied and frozen when the node is defined.

Nothing outside graph creation reads a node's `dependencies` for topology: the runtime, event matching, and diagnostics all go through `graph.getParents(...)`.

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

`getNodes` preserves registration order. Parents follow dependency declaration order and children are sorted by key. Returned collections are immutable and stable for the lifetime of the graph: repeated calls return the same frozen array, so it is safe to hold or compare them. Parents and children are always the nodes registered under those keys.

## Runtime relationship

The graph describes valid topology. `GraphRuntime` supplies current values and behaviour on top of it, including:

- Context mutation and descendant invalidation
- Dependency-aware execution
- Subscription-driven scheduling
- Prefetch and refresh
- Vue observation and component lifecycle integration

Runtime behaviour does not mutate graph definitions or topology.
