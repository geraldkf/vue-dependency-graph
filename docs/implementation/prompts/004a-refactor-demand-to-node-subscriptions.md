# Implementation Prompt 004A: Refactor Demand Terminology to Node Subscriptions

## Role

You are performing a focused public API and terminology refactor in `vue-dependency-graph` before implementing Step 3B.

Step 3A introduced a correct reference-counted lifecycle model, but its public terminology uses `demand`, which is too forceful and infrastructure-oriented for application developers.

Refactor the public API to use **node subscriptions** while preserving Step 3A behaviour exactly.

The intended terminology is:

```ts
const subscription = runtime.subscribeNodes([
  Targets,
  Credits,
]);

runtime.getSubscriptionState(Targets);
runtime.hasSubscribers(Targets);

subscription.unsubscribe();
```

The existing runtime change-listener API must be renamed from:

```ts
runtime.subscribe(listener);
```

to:

```ts
runtime.onChange(listener);
```

This avoids overloading the meaning of `subscribe`.

## Scope

Implement only the terminology and API refactor required to replace the public demand model.

Required changes:

- Rename node lifecycle registration from `addDemand` to `subscribeNodes`.
- Rename `DemandRegistration` to `NodeSubscription`.
- Rename `NodeDemandState` to `NodeSubscriptionState`.
- Rename `getDemandState` to `getSubscriptionState`.
- Rename `hasDemand` to `hasSubscribers`.
- Rename registration `release()` to `unsubscribe()`.
- Rename runtime change observation from `subscribe(listener)` to `onChange(listener)`.
- Rename internal demand terminology to subscription terminology where practical and clear.
- Rename Step 3A tests, documentation, and implementation notes accordingly.
- Update the Step 3B prompt so it uses the new terminology exclusively.
- Preserve all Step 3A runtime behaviour.

Do not implement automatic scheduling, prefetch, refresh, Vue composables, transactions, events, polling, mutations, metrics, snapshots, or devtools.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/08-demand-registration-implementation-note.md`
- `docs/implementation/prompts/004-implement-demand-registration-and-lifecycle.md`
- The Step 3B prompt, if already present
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`

Preserve existing project conventions and make the smallest complete refactor.

## Environment constraint

You are working in a contained environment.

Do not:

- Install dependencies
- Run pnpm commands
- Run TypeScript compilation
- Run Vitest
- Run Vite
- Claim offline validation succeeded

You must:

1. Update source, tests, prompts, and documentation.
2. Perform static inspection only.
3. Return a ZIP containing only files added, changed, renamed, or removed by this refactor.
4. Include a deletion manifest for obsolete files that must be removed locally.
5. Provide exact offline validation commands.

## Design decision

### Public lifecycle terminology

Use node subscription terminology:

```ts
runtime.subscribeNodes(nodes);
runtime.getSubscriptionState(node);
runtime.hasSubscribers(node);
subscription.unsubscribe();
```

A node subscription means:

> This consumer currently requires these nodes to remain active. The runtime tracks the subscription lifecycle and, after Step 3B, will automatically load stale subscribed nodes.

### Runtime change observation

Use:

```ts
runtime.onChange(listener);
```

This means:

> Notify this listener after committed runtime changes.

It must remain separate from node lifecycle subscriptions.

### Internal scheduler terminology

Public APIs and documentation must use:

- subscription
- subscriber
- subscribed node
- direct subscription
- required subscription
- total subscriber count

Architecture documentation may use the phrase **subscription-driven execution**.

Avoid `demand-driven` in public API documentation after this refactor. If the word `demand` remains in historical prompts or ADR context, it must be clearly historical or internal, not presented as the current API.

## Exact public API changes

### Before

```ts
const registration = runtime.addDemand([Targets]);

runtime.getDemandState(Targets);
runtime.hasDemand(Targets);

registration.release();

const unsubscribe = runtime.subscribe(listener);
```

### After

```ts
const subscription = runtime.subscribeNodes([Targets]);

runtime.getSubscriptionState(Targets);
runtime.hasSubscribers(Targets);

subscription.unsubscribe();

const stopObserving = runtime.onChange(listener);
```

## Public contracts

Replace:

```ts
interface NodeDemandState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

interface DemandRegistration {
  readonly nodes: readonly AnyNodeDefinition[];
  readonly release: () => void;
}
```

with:

```ts
interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

interface NodeSubscription {
  readonly nodes: readonly AnyNodeDefinition[];
  readonly unsubscribe: () => void;
}
```

The field names `direct`, `required`, and `total` should remain. They are concise and already have documented semantics.

Do not rename them to longer forms unless compiler or API usability evidence shows a real need.

## Runtime interface

The public `GraphRuntime` interface should expose:

```ts
interface GraphRuntime {
  readonly getState: ...;
  readonly setContext: ...;
  readonly execute: ...;

  readonly subscribeNodes: (
    nodes: readonly AnyNodeDefinition[]
  ) => NodeSubscription;

  readonly getSubscriptionState: (
    node: AnyNodeDefinition
  ) => NodeSubscriptionState;

  readonly hasSubscribers: (
    node: AnyNodeDefinition
  ) => boolean;

  readonly onChange: (
    listener: RuntimeListener
  ) => () => void;
}
```

Do not retain deprecated aliases in this research repository unless there is already external consumption requiring compatibility.

Current recommendation:

- Remove the old names completely.
- Let TypeScript identify missed call sites.
- Do not add `@deprecated` wrappers.

## Behaviour that must not change

The refactor must preserve all Step 3A behaviour.

### Subscription accounting

- Every node starts with zero subscription counts.
- Direct subscriptions count explicit node selection.
- Required subscriptions count transitive ancestors.
- Total is direct plus required.
- One subscription contributes once to each ancestor.
- Diamond ancestors are deduplicated per subscription.
- Multiple subscriptions contribute independently.
- Duplicate targets within one subscription are deduplicated.
- A directly subscribed parent does not also receive required count from a child in the same subscription.

### Lifecycle

- `unsubscribe()` removes exactly that subscription's contribution.
- `unsubscribe()` is idempotent.
- One subscription cannot remove another subscription's counts.
- Empty node subscription is a safe no-op.
- A completed subscription cannot be reactivated.

### Validation

- All nodes are validated before subscription counts change.
- An unregistered node rejects synchronously.
- Failed subscription applies no partial state.
- Key-equivalent node handles resolve to the registered definition.

### No scheduling yet

`subscribeNodes()` must not:

- Invoke a loader
- Evaluate a derived node
- Call `execute()`
- Queue a microtask
- Change node runtime data
- Change status or freshness
- Create an abort controller

`unsubscribe()` must not cancel execution yet.

Those behaviours remain Step 3B responsibilities.

### Runtime change observation

`onChange()` must preserve the previous listener semantics:

- Returns an idempotent stop function.
- One throwing listener does not prevent other listeners.
- Listener failures do not roll back committed state.
- No console logging from the core.
- Node subscription add and active unsubscribe each notify once.
- Empty subscription does not notify.
- Repeated unsubscribe does not notify.
- Failed subscription does not notify.

## Source file changes

### Rename `src/core/demand.ts`

Rename:

```text
src/core/demand.ts
```

to:

```text
src/core/subscription.ts
```

The new file should export:

```ts
NodeSubscription
NodeSubscriptionState
```

Remove the old file.

Update all imports and public exports.

### Update `src/core/runtime.ts`

Rename public API methods and internal terms.

Preferred internal naming:

```ts
subscriptionStates
MutableNodeSubscriptionState
requireSubscriptionState
getSubscriptionState
subscribeNodes
subscribedNodes
directKeys
requiredKeys
```

It is acceptable to retain a neutral internal term like `requiredKeys`.

Avoid mixed terminology such as:

```ts
subscribeNodes(...)
demandStates
```

unless there is a compelling implementation reason. Consistency is preferred.

### Update `src/core/index.ts`

Export only the new contracts.

Remove:

```ts
DemandRegistration
NodeDemandState
```

Export:

```ts
NodeSubscription
NodeSubscriptionState
```

### Update root exports

Confirm `src/index.ts` continues to expose the new public contracts through the core entry point.

## Test changes

Rename Step 3A test files:

```text
tests/core/demand-registration.spec.ts
tests/core/demand-propagation.spec.ts
tests/core/demand-lifecycle.spec.ts
tests/core/demand-types.test.ts
```

to:

```text
tests/core/node-subscription-registration.spec.ts
tests/core/node-subscription-propagation.spec.ts
tests/core/node-subscription-lifecycle.spec.ts
tests/core/node-subscription-types.test.ts
```

Remove the old test files.

Update test descriptions and variable names:

```ts
registration -> subscription
release -> unsubscribe
demand -> subscription state
listener subscription -> onChange observer
```

Do not weaken or remove Step 3A behavioural coverage.

### Add terminology-specific tests

Ensure tests explicitly verify:

- `subscribeNodes()` returns a `NodeSubscription` shape.
- Returned `nodes` remains frozen and deduplicated.
- `unsubscribe()` is idempotent.
- `getSubscriptionState()` returns a frozen snapshot.
- `hasSubscribers()` reflects total count.
- `onChange()` returns an idempotent stop function.
- `subscribeNodes()` and `onChange()` are clearly separate APIs.
- Old runtime method names do not exist in type tests.

Example negative type assertions:

```ts
// @ts-expect-error old demand API was removed
runtime.addDemand([Targets]);

// @ts-expect-error old demand inspection API was removed
runtime.getDemandState(Targets);

// @ts-expect-error runtime change observation was renamed
runtime.subscribe(listener);
```

Use these only in type-test files.

## Documentation changes

Update all active architecture, API, roadmap, implementation notes, and prompts that refer to Step 3A or future scheduler behaviour.

At minimum update:

- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/06-observability-devtools-and-snapshots.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/02-playground.md`
- `docs/implementation/08-demand-registration-implementation-note.md`
- `docs/implementation/prompts/004-implement-demand-registration-and-lifecycle.md`
- `docs/implementation/prompts/005-implement-automatic-demand-scheduler.md`, if present
- `docs/testing/01-test-strategy.md`

### Rename implementation note

Rename:

```text
docs/implementation/08-demand-registration-implementation-note.md
```

to:

```text
docs/implementation/08-node-subscription-implementation-note.md
```

Remove the old file.

### Rename Step 3A prompt

Rename:

```text
docs/implementation/prompts/004-implement-demand-registration-and-lifecycle.md
```

to:

```text
docs/implementation/prompts/004-implement-node-subscription-lifecycle.md
```

Update the prompt content so it reflects the final terminology. It may note that it supersedes the earlier demand terminology.

### Update Step 3B prompt

Rename the Step 3B prompt if necessary from:

```text
005-implement-automatic-demand-scheduler.md
```

to:

```text
005-implement-automatic-subscription-scheduler.md
```

Rewrite its current terminology consistently:

```text
demand registration -> node subscription
demand count -> subscription count
demanded node -> subscribed node
demand release -> unsubscribe
addDemand -> subscribeNodes
getDemandState -> getSubscriptionState
hasDemand -> hasSubscribers
release -> unsubscribe
runtime.subscribe(listener) -> runtime.onChange(listener)
```

The Step 3B scheduler concept should become:

> Automatically execute stale subscribed nodes and their required ancestors.

Do not change Step 3B behaviour or scope while renaming it.

### Roadmap terminology

Rename:

```text
Step 3A: Demand registration and lifecycle
```

to:

```text
Step 3A: Node subscription registration and lifecycle
```

Rename future references such as:

```text
Demand-driven cancellation
```

to:

```text
Subscription-driven cancellation
```

The milestone may be titled:

```text
Milestone 3: Subscriptions and automatic scheduling
```

### Historical documents

The repository may contain older duplicate root-level planning documents such as:

```text
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/README.md
```

Update them if they are still treated as active documentation. If they are obsolete duplicates, do not silently delete them in this refactor. Add a clear note or separate future cleanup task instead.

## Naming guidance

Use these preferred terms consistently:

```text
Node subscription
Subscriber
Subscribed node
Direct subscription
Required subscription
Total subscription count
Subscription lifecycle
Subscription-driven execution
Unsubscribe
Runtime change listener
onChange
```

Avoid these in active public documentation and API examples:

```text
Demand
Demand registration
Demand state
Demand count
Demand-driven loading
Release demand
```

The word `required` remains valid because it describes ancestor contribution.

## Public API examples after refactor

### Low-level core

```ts
const subscription = runtime.subscribeNodes([
  Targets,
  Credits,
]);

const targetsSubscription = runtime.getSubscriptionState(Targets);

if (runtime.hasSubscribers(Targets)) {
  // The node is active for at least one subscriber.
}

const stopObserving = runtime.onChange(() => {
  const state = runtime.getState(Targets);
});

subscription.unsubscribe();
stopObserving();
```

### Future Vue adapter

Document the intended direction without implementing it:

```ts
const targets = useNode(Targets);
```

Internally, the Vue adapter will perform:

```ts
const subscription = runtime.subscribeNodes([Targets]);

onScopeDispose(() => {
  subscription.unsubscribe();
});
```

## Backwards compatibility decision

This is a research repository with no established external consumers.

Therefore:

- Do not preserve old method aliases.
- Do not add deprecated wrappers.
- Do not export old type names.
- Let offline type checking identify any missed internal references.

Record this decision in the renamed Step 3A implementation note.

## Out of scope

Do not implement:

- Automatic execution
- Microtask scheduling
- Scheduler state
- `whenSettled`
- Subscription-driven cancellation
- Prefetch
- Manual refresh
- Vue plugin
- `useNode`
- `useNodes`
- Query groups
- Transactions
- Events
- Polling
- Retry policies
- Mutations
- Metrics
- Snapshots
- Devtools UI

This refactor must complete before Step 3B implementation begins.

## Quality requirements

- Preserve behaviour exactly.
- Prefer mechanical, comprehensive renaming over unrelated refactoring.
- Keep `src/core` independent of Vue, Pinia, devtools, and playground code.
- Do not use `any`.
- Do not suppress TypeScript errors except intentional `@ts-expect-error` assertions in type tests.
- Keep immutable node definitions free of subscription state.
- Keep runtime subscription counters private.
- Avoid console logging in core source.
- Avoid global state.
- Do not add compatibility aliases.
- Do not implement Step 3B behaviour accidentally.

## Static inspection in the contained environment

Perform checks that do not require installed dependencies:

1. Parse JSON configuration files.
2. Run the core boundary script if available.
3. Confirm no workspace files or nested package manifests were introduced.
4. Search `src/core` for Vue, Pinia, devtools, and playground imports.
5. Search implementation and tests for explicit `any` usage.
6. Confirm TypeScript suppression comments occur only in intentional type tests.
7. Search core source for console logging.
8. Confirm no scheduler, prefetch, refresh, transaction, event, polling, mutation, metrics, snapshot, or Vue integration was introduced.
9. Confirm immutable node definitions contain no subscription counters or listeners.
10. Confirm `src/core/demand.ts` no longer exists.
11. Confirm old Step 3A test filenames no longer exist.
12. Confirm the old Step 3A implementation note no longer exists.
13. Confirm the old Step 3A prompt filename no longer exists.
14. Confirm the old Step 3B prompt filename no longer exists if it was renamed.
15. Search active source, tests, and current documentation for these obsolete API identifiers:

```text
addDemand
getDemandState
hasDemand
DemandRegistration
NodeDemandState
.release()
runtime.subscribe(
```

16. Review remaining uses of the word `demand`. Every remaining occurrence must be historical, explicitly superseded, or removed.
17. Confirm `subscribeNodes`, `getSubscriptionState`, `hasSubscribers`, `unsubscribe`, and `onChange` are publicly exported or exposed as intended.
18. Confirm all renamed tests and documentation are included.
19. Create a deletion manifest listing every obsolete file the developer must remove.
20. Create a ZIP containing only files added or changed by this refactor plus the deletion manifest.
21. Validate ZIP integrity and contents before responding.

These checks are not proof that TypeScript, Vitest, or the build passes.

## ZIP and deletion manifest

Because ZIP extraction does not remove old files, include:

```text
refactor-deletions.txt
```

It should list repository-relative files to delete, one per line.

Expected deletions include at least:

```text
src/core/demand.ts
tests/core/demand-registration.spec.ts
tests/core/demand-propagation.spec.ts
tests/core/demand-lifecycle.spec.ts
tests/core/demand-types.test.ts
docs/implementation/08-demand-registration-implementation-note.md
docs/implementation/prompts/004-implement-demand-registration-and-lifecycle.md
```

If the Step 3B prompt is renamed, include its old filename too.

The completion response must instruct the developer to delete these files before or after overlaying the ZIP.

## Offline validation

After applying the ZIP and deleting files listed in `refactor-deletions.txt`, run:

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

If tests fail, capture:

```powershell
pnpm test:run --reporter verbose --no-color 2>&1 |
    Tee-Object -FilePath ".\unit-test-output.log"
```

Also search locally for obsolete public API names:

```powershell
Get-ChildItem -Path .\src, .\tests, .\docs -Recurse -File |
    Select-String -Pattern "addDemand|getDemandState|hasDemand|DemandRegistration|NodeDemandState"
```

Expected result:

- No active source or test usage.
- Documentation matches only if it explicitly discusses superseded terminology.

## Prepared acceptance criteria

The refactor is ready for offline validation when:

- `subscribeNodes()` replaces `addDemand()`.
- `getSubscriptionState()` replaces `getDemandState()`.
- `hasSubscribers()` replaces `hasDemand()`.
- `NodeSubscription` replaces `DemandRegistration`.
- `NodeSubscriptionState` replaces `NodeDemandState`.
- `unsubscribe()` replaces registration `release()`.
- `onChange()` replaces runtime listener `subscribe()`.
- Direct, required, and total subscription semantics are unchanged.
- All Step 3A tests are renamed and preserve coverage.
- Negative type tests confirm old APIs are removed.
- Source, documentation, roadmap, implementation notes, and Step 3B prompt use consistent terminology.
- No compatibility aliases remain.
- No automatic scheduler behaviour was implemented.
- A deletion manifest is included.
- A changes-only ZIP is returned and validated.

## Validated acceptance criteria

The refactor is complete only after the developer reports:

- Obsolete files from `refactor-deletions.txt` were removed.
- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground still starts and renders.
- Search finds no active obsolete API usage.
- Existing subscription lifecycle behaviour remains unchanged.
- No unhandled promise rejections occur.

## Expected completion response

Provide:

1. A concise summary of the terminology refactor.
2. A ZIP containing only files added or changed by the refactor.
3. The deletion manifest and explicit deletion instructions.
4. Files added, changed, renamed, and removed.
5. The final public API before and after comparison.
6. Confirmation that behaviour was intentionally preserved.
7. Static checks performed and their results.
8. Project commands not run in the contained environment.
9. Exact offline validation steps.
10. Any remaining historical uses of `demand` and why they remain.

Do not claim that type checking, tests, builds, or the playground passed unless the developer later reports those results.
