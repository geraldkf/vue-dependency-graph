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
  load: ({ get, signal }) => api.getTargets(get(JobSeekerId), get(PointPeriodId), signal),
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
    get(Permissions).includes("credit.modify") && get(CurrentCredit)?.status !== "Finalised",
});
```

Asynchronous work belongs in a data node so it shares the runtime's loading, cancellation, error, refresh, and metrics model.

## Refresh policy metadata

Data-node definitions may carry one immutable refresh policy created by `staleAfter(...)`, `refreshInterval(...)`, or `pollUntil<TValue>(...)`. The policy is graph metadata only; a runtime's refresh-policy controller owns the timers, retry counters, pause state, and polling sessions built on that metadata. See [Scheduler, transactions, and concurrency](./03-scheduler-transactions-and-concurrency.md).

Context and derived nodes cannot declare refresh policies. Graph creation defensively validates policy metadata but does not evaluate polling predicates or create runtime activity.

## Release policy metadata

Data-node definitions may carry one immutable release policy created by `releaseAfter(...)`, or opt out of the runtime default with `retain()`. Like refresh policies, this is graph metadata only; a runtime's release-policy controller owns the timer that decides when an idle node's value is reset. Context and derived nodes cannot declare a release policy: a context value is caller-provided input rather than cache, and derived values are recomputed from their dependencies. See [ADR-016](../decisions/ADR-016-value-release-policies.md) and [Scheduler, transactions, and concurrency](./03-scheduler-transactions-and-concurrency.md).

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

## State transitions

A node's runtime state is five fields that only make sense together: `status`, `freshness`, `error`, `hasSuccessfulValue`, and `data`, plus the `generation` counter. Every write to them goes through one of eight named transitions in `src/core/state/transitions.ts`. Each transition sets all the fields that must change together, so a node is never left in a state the fields do not describe.

| Transition        | What it means                                                                                                                                                                                                                            | Generation |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `invalidate`      | The value is out of date and anything running for the node is superseded. Keeps the value; `success` if there is one, else `idle`; clears the error. Used by context, event, and mutation invalidation and by refresh.                   | +1         |
| `beginAttempt`    | An execution attempt starts: `refreshing` if a value exists, else `loading`; stale; no error.                                                                                                                                            | -          |
| `succeedAttempt`  | An attempt produced a value: stored, `success`, fresh, no error, has a value.                                                                                                                                                            | -          |
| `failAttempt`     | An attempt, or a policy acting on the node, failed: `error`, stale, error recorded. Keeps the last value and its flag.                                                                                                                   | -          |
| `abortAttempt`    | An attempt ended without a result and nothing superseded the node (aborted because the last subscriber left, or cancelled while queued): not running any more. Keeps any value; `success` if there is one, else `idle`; stale; no error. | -          |
| `writeValue`      | A value is written directly: a context write or a mutation's optimistic or success update. Fresh, or stale when the same mutation also invalidates something the value depends on.                                                       | +1         |
| `restoreSnapshot` | A mutation puts back what its optimistic update replaced.                                                                                                                                                                                | +1         |
| `releaseValue`    | An idle value is dropped: initial value, no successful value, `idle`, stale.                                                                                                                                                             | +1         |

**The generation rule.** `generation` counts how many times a node's state has been superseded, and stale in-flight work is compared against it. Transitions that supersede in-flight work bump it (`invalidate`, `writeValue`, `restoreSnapshot`, `releaseValue`). The attempt lifecycle (`beginAttempt`, `succeedAttempt`, `failAttempt`, `abortAttempt`) never does, because it is what the generation check guards. A restore bumps rather than rewinds, so a generation always identifies one committed version of state.

**What callers own.** Transitions only change the state object. Notification, scheduling, aborting attempts, diagnostics, and precondition checks such as generation comparisons stay with the caller, because their order differs per site.

**Invariants.** Every transition maps a valid state to a valid state. A state is valid when: an error is present exactly when `status` is `error`; `loading` and `refreshing` are stale; `refreshing` and `success` have a successful value and `loading` and `idle` do not; and a fresh node is a `success` with a value. `tests/core/state-transitions.spec.ts` checks this for every transition from every valid starting state, and the state traces check it on every change notification.

**Aborted attempts.** An attempt that is aborted or cancelled applies `abortAttempt` only if it still owns the node's state - its generation is unchanged and it is still the active attempt. An attempt superseded by an invalidation, a context or mutation write, a rollback, or a release leaves that transition's state alone. Before this, an aborted attempt left the node showing `loading` or `refreshing` with nothing in flight until something executed it again.

**Refresh clears the previous failure.** Marking a node stale for a refresh is the `invalidate` transition, like any other invalidation. A refresh that follows a failed one therefore never exposes the old error next to a non-error status.

**Enforcement.** The rule is enforced at compile time, with two textual checks and tests behind it.

- The state record (`NodeStateRecord`, returned by the store's `getNodeState`) has `readonly` fields, so assigning a field, compound-assigning it, or incrementing `generation` anywhere outside `transitions.ts` is a compile error. `transitions.ts` holds the only writable view, a private cast that is not exported. `tests/core/state-types.test.ts` pins this with `@ts-expect-error` on every field; `tsc` checks it as part of `pnpm typecheck`.
- `pnpm check:boundaries` fails if a writable mapped type (`-readonly`) appears anywhere else in `src/core`, which is how a second writable view would be created.
- The same script keeps an allowlist of the modules that may import the transitions (execution, invalidation, mutation commit, operations, the release controller, and the policy services). Who may change node state is therefore a reviewed list; adding a module to it is a deliberate decision.

What this does not cover: the compiler does not stop `Object.assign` or a cast to `any` on a state record, and it controls writes, not which module may perform a transition - the allowlist does that textually. Bound, key-based transitions injected into controllers (so controllers hold no state references at all) would tighten both, and are the natural shape for policy extensions; see the roadmap.

## Runtime relationship

The graph describes valid topology. `GraphRuntime` supplies current values and behaviour on top of it, including:

- Context mutation and descendant invalidation
- Dependency-aware execution
- Subscription-driven scheduling
- Prefetch and refresh
- Vue observation and component lifecycle integration

Runtime behaviour does not mutate graph definitions or topology.
