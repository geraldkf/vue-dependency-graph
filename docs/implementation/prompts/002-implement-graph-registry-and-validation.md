# Implementation Prompt 002: Implement the Graph Registry and Validation

## Role

You are implementing Milestone 1 of `vue-dependency-graph`: the framework-agnostic graph registry and topology validation foundation.

The repository is a single private pnpm package with logical layers under `src`. All implementation in this milestone belongs in `src/core`. Do not introduce separate packages or workspace configuration.

Implement only:

- Strongly typed node handles
- Context, data, and derived node definitions
- Order-independent graph registration
- Parent and child indexes
- Duplicate-key validation
- Missing-dependency validation
- Cycle validation
- Read-only topology inspection

Do not implement runtime node state, loading, scheduling, subscription, subscriptions, Vue composables, transactions, events, polling, mutations, metrics, snapshots, or devtools UI.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/04-bootstrap-implementation-note.md`
- `docs/testing/01-test-strategy.md`
- `src/core/index.ts`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Also review the existing dependency service supplied as reference material if it is available. Use it to understand the proven concepts, but do not copy its Vue refs, mutable node objects, creation-order dependency, execution code, or subscription behaviour into the new core.

If the repository differs from these documents, state the discrepancy and make the smallest reasonable adjustment.

## Environment constraint

You are working in a contained environment. Do not install dependencies, run pnpm commands, execute Vitest, run TypeScript builds, or start Vite.

Your responsibilities are to:

1. Create or update the required source, test, and documentation files.
2. Perform static inspection that does not require installed dependencies.
3. Check file consistency, exports, import boundaries, and obvious type-design issues.
4. Provide exact offline validation commands to the developer.
5. Report build, test, and type-check results as `Not run in contained environment`.

The developer will run the project offline and return any errors or observations. Do not claim that tests, type checks, builds, or runtime validation succeeded.

## Objective

Create a small, immutable, strongly typed graph-definition API and a validated graph registry whose topology is correct regardless of node registration order.

The intended usage should be close to:

```ts
const JobSeekerId = defineContextNode<number | undefined>({
  key: "jobSeekerId",
  initialValue: undefined,
});

const PointPeriods = defineDataNode({
  key: "pointPeriods",
  dependencies: [JobSeekerId],
  initialValue: [] as PointPeriod[],
  load: async ({ get, signal }) =>
    api.getPointPeriods(get(JobSeekerId), signal),
});

const CurrentPointPeriod = defineDerivedNode({
  key: "currentPointPeriod",
  dependencies: [PointPeriods],
  derive: ({ get }) => get(PointPeriods).find(period => period.isCurrent),
});

const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});
```

The final line intentionally registers children before parents. It must behave exactly like parent-first registration.

## Core design constraints

### 1. Definitions are immutable descriptors

Node definitions describe topology and future execution behaviour. They must not contain mutable runtime status, current data, current error, subscribers, or execution state.

Runtime state will be implemented in a later milestone and stored separately inside a graph instance.

Make node definitions immutable through their public TypeScript shape. Runtime freezing is optional and should only be added if it remains simple and does not interfere with function properties.

### 2. Typed handles, not string-only APIs

Every node definition is also its typed handle.

The handle must carry:

- A stable string key
- Node kind
- Result type at compile time
- Dependencies
- Kind-specific configuration

Consumers should later be able to pass a handle to `get`, `useNode`, and other APIs and retain the node result type.

Do not expose constructors that allow consumers to create malformed handles manually. Prefer factory functions and an internal brand using a `unique symbol` or equivalent type-only mechanism.

Do not use a global registry or global mutable symbol-to-node map.

### 3. Node keys

Use non-empty strings as diagnostic and serialisation identifiers.

Validation requirements:

- Reject an empty key.
- Reject a whitespace-only key.
- Reject duplicate keys, even if the duplicate definitions are otherwise identical.
- Include the conflicting key in the error message.

Do not add naming conventions beyond non-empty strings in this milestone.

### 4. Node kinds

Implement these three kinds.

#### Context node

Required configuration:

```ts
interface ContextNodeOptions<T> {
  key: string;
  initialValue: T;
}
```

Context nodes have no dependencies in Milestone 1. Context dependencies are conceptually unnecessary because data and derived nodes should depend directly on all context inputs they need.

#### Data node

Required configuration should support:

```ts
interface DataNodeOptions<T, TDependencies> {
  key: string;
  dependencies?: TDependencies;
  initialValue: T;
  load: (context: LoadContext<TDependencies>) => Promise<T>;
}
```

The loader must be retained as part of the immutable definition but must never be invoked in this milestone.

Its context should expose typed placeholders for the future execution API:

```ts
interface LoadContext<TDependencies> {
  get: GetDependencyValue<TDependencies>;
  signal: AbortSignal;
}
```

It is acceptable to define the `get` typing now without implementing a runtime getter. Avoid using `any`.

#### Derived node

Required configuration should support:

```ts
interface DerivedNodeOptions<T, TDependencies> {
  key: string;
  dependencies: TDependencies;
  derive: (context: DeriveContext<TDependencies>) => T;
}
```

Derived computation is synchronous. Retain the function but do not execute it in this milestone.

Do not add async derived nodes.

### 5. Dependency type safety

Dependencies should be a readonly tuple or readonly array of node handles.

The `get` function passed to a loader or derived function should accept only one of that node's declared dependency handles and return the associated value type.

Example intent:

```ts
const Combined = defineDerivedNode({
  key: "combined",
  dependencies: [Count, Label] as const,
  derive: ({ get }) => `${get(Label)}: ${get(Count)}`,
});
```

The following should fail type checking in a dedicated type test because `OtherNode` is not declared as a dependency:

```ts
get(OtherNode);
```

Keep the type implementation understandable. Do not introduce a large generic abstraction merely to avoid one explicit helper type.

### 6. Graph creation and finalisation

Provide a public factory close to:

```ts
const graph = createGraph({ nodes });
```

`createGraph` must fully register and validate the supplied definitions before returning.

Registration order must not matter. Build indexes from the complete definition set rather than adding child references only when a parent already exists.

Do not expose a partially valid graph from `createGraph`.

Dynamic registration after graph creation is out of scope. Prefer an immutable topology for the first release.

### 7. Graph indexes

Maintain internal indexes sufficient for later milestones:

- Node by key
- Parents by node key
- Children by node key

Requirements:

- Every registered node appears in every relevant index.
- Nodes with no parents or children return empty collections.
- A diamond graph does not duplicate edges.
- Index construction is independent of registration order.
- Returned inspection collections cannot mutate internal graph state.

Use keys internally for stable lookup, but expose typed node handles where useful to consumers.

### 8. Duplicate dependencies

Reject a node that lists the same dependency key more than once.

This is preferable to silently deduplicating because duplicate declaration is likely a definition mistake.

The validation error must identify both the node and duplicated dependency.

### 9. Missing dependencies

If a node references a handle whose key is not included in the graph's node set, graph creation must fail.

The error must identify:

- The node containing the reference
- The missing dependency key

Do not silently treat a missing parent as already loaded or optional.

A separate definition with the same key as the missing handle is resolved by key only after duplicate-key checks. Graph identity is key-based for topology and diagnostics.

### 10. Cycle detection

Detect:

- Self-dependencies
- Two-node cycles
- Longer cycles
- Cycles in disconnected graph components

The error should include a readable cycle path where practical, for example:

```text
Circular dependency detected: A -> B -> C -> A
```

Use a deterministic traversal so the same graph produces a stable diagnostic message.

Do not rely on registration order for cycle detection results.

### 11. Validation errors

Create a small framework-specific validation error type, such as:

```ts
class GraphValidationError extends Error
```

It may include a narrow error code union if that improves behavioural tests and future diagnostics, for example:

```ts
type GraphValidationErrorCode =
  | "INVALID_NODE_KEY"
  | "DUPLICATE_NODE_KEY"
  | "DUPLICATE_DEPENDENCY"
  | "MISSING_DEPENDENCY"
  | "CIRCULAR_DEPENDENCY";
```

Keep this explicit and small. Do not build a general diagnostics system yet.

Tests should primarily verify behaviour and useful error information, not exact full error strings unless stability is intentional.

### 12. Read-only topology inspection

Expose only the minimum inspection API needed to verify and understand the registry.

Suggested shape:

```ts
interface Graph {
  getNode(key: string): AnyNodeDefinition | undefined;
  hasNode(key: string): boolean;
  getParents(nodeOrKey: AnyNodeDefinition | string): readonly AnyNodeDefinition[];
  getChildren(nodeOrKey: AnyNodeDefinition | string): readonly AnyNodeDefinition[];
  getNodes(): readonly AnyNodeDefinition[];
}
```

Exact naming may be adjusted if a simpler consistent API emerges.

Requirements:

- Results are deterministic.
- Results are read-only from the consumer perspective.
- Unknown keys return `undefined` or an empty collection consistently and are documented.
- Inspection does not expose mutable internal maps or sets.

Do not implement graph visualisation, DOT output, metrics, snapshots, or runtime status inspection yet.

## Suggested source organisation

Use a structure no more complex than necessary. A reasonable starting point is:

```text
src/core/
├── errors.ts
├── graph.ts
├── index.ts
├── nodes.ts
└── types.ts
```

Tests may be organised as:

```text
tests/core/
├── graph-registration.spec.ts
├── graph-validation.spec.ts
├── node-definitions.spec.ts
└── node-types.test-d.ts
```

Do not split every interface into its own file. Match the existing project naming and formatting conventions.

## Public exports

Update `src/core/index.ts` to export only intended public contracts.

Update `src/index.ts` so the root entry point continues to expose the public core API.

Do not export internal registry maps, mutable builders, internal brands, traversal helpers, or test utilities.

The Vue and devtools placeholder layers should remain unchanged unless an import must be adjusted because the old bootstrap placeholder export is replaced. Keep those changes minimal.

## Tests

Use Vitest 3.0.7 and TypeScript.

### Behaviour tests required

#### Node definitions

- Defines a context node with typed initial value.
- Defines a data node with dependencies, initial value, and unexecuted loader.
- Defines a synchronous derived node.
- Exposes immutable/read-only definition properties through the public API.
- Rejects blank keys at the appropriate public boundary.

#### Order-independent registration

Create equivalent graphs using:

- Parent-first order
- Child-first order
- Mixed order

Verify they expose equivalent parent and child topology.

#### Parent and child indexes

Cover:

- Root node
- Leaf node
- Multiple parents
- Multiple children
- Diamond graph
- Disconnected graph

#### Duplicate validation

- Duplicate node key
- Duplicate dependency within one node

#### Missing dependency validation

- Missing direct dependency
- Missing dependency in a disconnected component

#### Cycle validation

- Self-cycle
- Two-node cycle
- Three-or-more-node cycle
- Cycle in a disconnected component
- Valid diamond graph is not reported as cyclic

#### Inspection

- Get node by key
- Unknown key behaviour
- Stable registered-node order
- Returned collections cannot alter the graph's internal topology

### Type tests required

Add compile-time checks for:

- Inferred context-node value type
- Inferred data-node result type
- Inferred derived-node result type
- `get` returns the correct type for each declared dependency
- `get` rejects undeclared dependencies
- A data loader must resolve the declared node value type
- A derived function must return the declared/inferred node value type

Use the simplest mechanism compatible with the existing repository. Prefer regular `.ts` files included by `tsconfig` with `@ts-expect-error` for negative assertions rather than adding a new type-test dependency.

Do not use `any` in implementation or tests.

## Documentation updates

Update only documentation affected by decisions made in this milestone.

At minimum:

- Update `docs/architecture/02-graph-and-node-model.md` if the concrete API differs from the proposal.
- Update `docs/api/01-proposed-api.md` with the implemented Milestone 1 API and label later APIs as proposed.
- Update `docs/implementation/01-roadmap.md`:
  - Mark generated Milestone 1 work as prepared.
  - Leave offline validation pending.
  - Do not mark Milestone 2 work complete.
- Add `docs/implementation/06-graph-registry-implementation-note.md` containing:
  - Status
  - Files changed
  - Key implementation decisions
  - Static checks performed
  - Offline validation commands
  - Known risks or questions

Add or update an ADR only if implementation materially changes an accepted architecture decision.

## Out of scope

Do not implement:

- Runtime data storage
- Node status or freshness
- Loading or execution
- Dependency value resolution at runtime
- Abort-controller creation or cancellation
- Scheduling
- Subscription tracking
- Subscriptions
- Vue refs or composables
- Context mutation
- Invalidation
- Transactions
- Domain events
- Query groups
- Refresh policies or polling
- Retry policies
- Optimistic mutation
- Partial failure execution
- Metrics
- Snapshots
- Devtools visualisation
- Dynamic graph registration

If a future-facing type is needed to type a retained loader or derived function, define only the minimal type contract and do not implement its runtime behaviour.

## Quality requirements

- Prefer the simplest design satisfying typed handles and validated topology.
- Keep definitions immutable and runtime state absent.
- Keep `src/core` independent of Vue, Pinia, DOM-specific APIs, devtools, and playground code.
- Do not use `any`.
- Do not suppress TypeScript errors except intentional `@ts-expect-error` assertions in type tests.
- Use clear error messages containing relevant node keys.
- Avoid hidden global state.
- Avoid classes unless they provide clear value. A small `GraphValidationError` class is acceptable.
- Avoid public APIs that will force later runtime implementation into mutable node definitions.
- Keep changes surgical and within Milestone 1.

## Static inspection in the contained environment

Perform checks that do not require installed project dependencies:

- List changed and added files.
- Parse JSON configuration files.
- Inspect public exports.
- Confirm no workspace files or nested package manifests were introduced.
- Run the dependency-free core boundary script if available.
- Search `src/core` for Vue, Pinia, devtools, and playground imports.
- Search implementation files for `any` and unexplained TypeScript suppression comments.
- Confirm no execution, scheduler, event, transaction, polling, or mutation modules were introduced.
- Confirm test files cover every required behavioural category.
- Confirm documentation marks validation as pending.

These are static checks, not proof that TypeScript or Vitest passes.

## Offline validation for the developer

Ask the developer to run from the repository root:

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check:boundaries
pnpm typecheck
pnpm test:run
pnpm build
pnpm dev
```

The development server only needs to run long enough to confirm that the unchanged playground still renders.

The developer should return:

- Node.js version
- pnpm version
- Full output for failed commands
- Type errors, including file and line number
- Failed test names and assertion output
- Any dependency warnings
- Confirmation that the playground still renders

## Prepared acceptance criteria

The contained-environment changes are ready for offline validation when:

- Context, data, and derived node factories exist.
- Public node handles retain result types.
- Node definitions do not contain runtime state.
- Graph creation accepts nodes in any order.
- Parent and child indexes are constructed from the full node set.
- Blank keys, duplicates, missing dependencies, and cycles are rejected.
- Topology inspection is read-only.
- Required behaviour and type tests are present.
- Public exports are intentional.
- Core remains independent of Vue and other logical layers.
- Documentation describes the implemented API and marks validation pending.
- No Milestone 2 or later behaviour is implemented.

## Validated acceptance criteria

Milestone 1 is complete only after the developer reports:

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground still starts and renders.
- Parent-first, child-first, and mixed registration tests pass.
- All required validation and type tests pass.
- Any reported issues have been fixed and revalidated.

## Expected completion response

Provide:

1. A concise summary of the graph registry prepared.
2. Files added, changed, and removed.
3. The final public API shape.
4. Key type-design and validation decisions.
5. Static checks performed and their results.
6. Project commands not run in the contained environment.
7. Exact offline validation steps.
8. Assumptions, deviations, known limitations, and risks for Milestone 2.

Do not claim that type checking, tests, builds, or the playground passed unless the developer later reports those results.
