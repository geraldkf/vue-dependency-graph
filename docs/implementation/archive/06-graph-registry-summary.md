# Milestone 1: Graph Registry and Validation

## Status

Implementation complete; final combined offline validation pending.

The graph registry has been exercised by all later runtime, Vue, Pinia, and playground milestones. A recent full type check exposed an unrelated playground tuple-inference issue, which was fixed separately. Milestone 1 should be marked fully validated after the final combined typecheck, test, build, and boundary commands pass.

## Delivered capabilities

- Immutable, strongly typed node handles
- Context, data, and derived node definitions
- Typed dependency access for loaders and derived functions
- Order-independent graph creation
- Key-based graph identity
- Parent and child indexes
- Duplicate node-key validation
- Duplicate dependency validation
- Missing dependency validation
- Self-cycle and multi-node cycle validation
- Forward-reference dependency resolvers
- Read-only topology inspection
- Behavioural and compile-time tests

## Node model

### Context nodes

Context nodes declare a mutable runtime input and its initial value:

```ts
const JobSeekerId = defineContextNode<number | undefined>({
  key: "jobSeekerId",
  initialValue: undefined,
});
```

The definition itself is immutable. Current values belong to each `GraphRuntime`.

### Data nodes

Data nodes declare asynchronous work and typed dependencies:

```ts
const PointPeriods = defineDataNode({
  key: "pointPeriods",
  dependencies: [JobSeekerId] as const,
  initialValue: [] as PointPeriod[],
  load: ({ get, signal }) =>
    api.getPointPeriods(get(JobSeekerId), signal),
});
```

The loader is retained by the definition but executed only by a runtime.

### Derived nodes

Derived nodes calculate synchronously from successful dependencies:

```ts
const CurrentPointPeriod = defineDerivedNode({
  key: "currentPointPeriod",
  dependencies: [PointPeriods] as const,
  derive: ({ get }) => get(PointPeriods).find(period => period.isCurrent),
});
```

Asynchronous derived work remains represented as a data node so loading, cancellation, error, refresh, and metrics behaviour use one execution model.

## Graph creation

```ts
const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});
```

Registration order does not affect topology. Graph creation receives the complete definition set, validates it, builds indexes, and returns an immutable inspection surface. Dynamic registration is not supported.

## Identity and validation

Graph identity is key-based. A different definition object with a registered key resolves to the registered graph node where runtime APIs explicitly support equivalent handles.

Graph construction rejects:

- Empty or whitespace-only keys
- Duplicate node keys
- Duplicate dependency keys within one node
- Dependencies omitted from the graph
- Self-dependencies
- Cycles in connected or disconnected components

Validation uses `GraphValidationError` and a narrow `GraphValidationErrorCode` union. Cycle errors include a readable path where practical.

## Topology inspection

```ts
const node = graph.getNode("pointPeriods");
const parents = graph.getParents(PointPeriods);
const children = graph.getChildren(JobSeekerId);
const nodes = graph.getNodes();
```

- `getNode` returns `undefined` for an unknown key.
- `hasNode` returns `false` for an unknown key.
- Parent and child inspection returns an empty frozen array for an unknown key.
- Registered-node order is preserved by `getNodes`.
- Parent order follows dependency declaration order.
- Child order is deterministic by key.
- Returned collections are frozen copies and cannot mutate graph indexes.

## Test coverage

Behavioural tests cover:

- Parent-first, child-first, and mixed registration order
- Roots, leaves, multiple parents, multiple children, diamonds, and disconnected nodes
- Stable and immutable topology inspection
- Blank keys and duplicate keys
- Duplicate and missing dependencies
- Self, two-node, and longer cycles
- Valid diamond graphs
- Immutable node descriptors that do not execute retained functions

Compile-time tests cover inferred node values, typed dependency getters, rejection of undeclared dependencies, loader result types, and derived result types.

## Validation commands

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

The graph-specific implementation is complete. Final milestone validation should use the combined current repository rather than attempting to recreate the original isolated Milestone 1 state.

## Historical record

The original implementation prompt and the separate Phase 1 planning document are removed from active documentation because the implementation now exists and the maintained architecture, API, tests, and this summary describe the current behaviour. Git history remains the source for point-in-time implementation instructions.
