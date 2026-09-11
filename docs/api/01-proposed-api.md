# Public API

## Implemented in Milestone 1

### Define context nodes

```ts
const JobSeekerId = defineContextNode<number | undefined>({
  key: "jobSeekerId",
  initialValue: undefined,
});
```

### Define data nodes

```ts
const PointPeriods = defineDataNode({
  key: "pointPeriods",
  dependencies: [JobSeekerId] as const,
  initialValue: [] as PointPeriod[],
  load: ({ get, signal }) =>
    api.getPointPeriods(get(JobSeekerId), signal),
});
```

The loader is only defined in Milestone 1. It is not executed by the registry.

### Define derived nodes

```ts
const CurrentPointPeriod = defineDerivedNode({
  key: "currentPointPeriod",
  dependencies: [PointPeriods] as const,
  derive: ({ get }) => get(PointPeriods).find(period => period.isCurrent),
});
```

Derived functions are synchronous.

### Forward dependency references

For definitions that cannot use an eagerly constructed tuple:

```ts
const First = defineDerivedNode({
  key: "first",
  dependencies: () => [Second] as const,
  derive: () => "first",
});
```

Dependency resolvers are evaluated during graph creation and must be synchronous, side-effect free, and stable.

### Create and inspect a graph

```ts
const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});

graph.getNode("pointPeriods");
graph.hasNode("pointPeriods");
graph.getParents(CurrentPointPeriod);
graph.getChildren(JobSeekerId);
graph.getNodes();
```

Graph creation validates the complete topology regardless of registration order.

### Validation errors

```ts
try {
  createGraph({ nodes });
} catch (error) {
  if (error instanceof GraphValidationError) {
    console.log(error.code, error.message);
  }
}
```

Implemented error codes:

```ts
type GraphValidationErrorCode =
  | "INVALID_NODE_KEY"
  | "DUPLICATE_NODE_KEY"
  | "DUPLICATE_DEPENDENCY"
  | "MISSING_DEPENDENCY"
  | "CIRCULAR_DEPENDENCY";
```

### Result type extraction

```ts
type PointPeriodsValue = NodeValue<typeof PointPeriods>;
```

## Proposed for later milestones

The following APIs are not implemented yet.

### Vue consumption

```ts
const { data, status, freshness, error, refresh } = useNode(PointPeriods);
```

### Multiple nodes

```ts
const query = useNodes({
  selectedPeriod: CurrentPointPeriod,
  periods: PointPeriods,
});
```

### Query groups

```ts
const ManageCreditsQuery = defineQuery({
  key: "manageCredits",
  nodes: {
    selectedPointPeriod: SelectedPointPeriod,
    credits: Credits,
  },
});
```

### Transactions, events, prefetch, and refresh

```ts
await graph.transaction(() => {
  graph.set(JobSeekerId, jobSeekerId);
  graph.set(PointPeriodId, pointPeriodId);
});

graph.publish(AppointmentBooked, event);
await graph.prefetch(ManageCreditsQuery);
await graph.refresh(Targets);
```

These examples describe direction only and must not be treated as stable until their milestones are implemented.
