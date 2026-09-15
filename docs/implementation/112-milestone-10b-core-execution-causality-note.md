# Milestone 10B: Core Execution Causality

## Status

Implemented and statically reviewed. Dependency-backed repository validation is pending.

## Scope

M10B extends the M10A diagnostic foundation across ordinary subscriptions, scheduling, caller operations, context invalidation, dependency execution, concurrency queueing, refresh result invalidation, and execution outcomes.

Transactions, typed event publication, refresh-policy lifecycle events, and mutation lifecycle events remain M10C work.

## Delivered diagnostics

### Subscription lifecycle

The subscription controller emits committed `subscription.added` and `subscription.removed` records containing direct and required node keys. Empty subscriptions and repeated unsubscribe remain silent.

### Scheduler lifecycle

The scheduler emits:

- `scheduler.requested` when an idle scheduler pass is queued;
- `scheduler.started` with the targets selected at flush time;
- `scheduler.completed` after successful settlement;
- `scheduler.failed` with a safe error record after scheduler failure.

Coalesced schedule requests remain coalesced. Diagnostics do not create another scheduler pass or alter `whenSettled()`.

### Execution lifecycle

Execution emits:

- `node.execution.skipped` for a fresh successful value;
- `node.execution.reused` when the caller joins a current same-generation attempt;
- `node.execution.blocked` when a dependency branch fails;
- `node.load.queued` only when concurrency capacity is unavailable;
- load start, success, failure, abort, and discarded-result records;
- derived start, success, and failure records.

Events retain node key, node kind, generation, origin, reason, operation ID, optional cause ID, duration where meaningful, and safe error details.

### Invalidation lifecycle

Immediate context writes emit one `context.changed` summary and one `node.invalidated` summary after the committed graph transition. Changed refresh results emit one descendant invalidation summary. The affected node arrays follow the runtime's deterministic traversal order.

Transaction-owned context and event diagnostics remain M10C work and are deliberately not inferred from the immediate-write instrumentation.

## Causality model

Caller-owned execute, prefetch, refresh, and query operations use the operation ID created by their M10A request event.

Scheduler work receives a separate scheduler operation ID. Its `causeId` points to the subscription or invalidation operation that requested the scheduler pass. Required ancestors use reason `dependency`, while directly requested targets retain the initiating reason.

Execution origin remains unchanged and continues to control cancellation ownership. Diagnostic reason is additional descriptive metadata and does not participate in runtime decisions.

## Internal changes

- `RuntimeExecutionController.execute(...)` accepts an optional diagnostic context.
- The concurrency limiter accepts an optional queue callback and invokes it only when acquisition actually waits.
- The operations controller forwards diagnostic context without owning diagnostics.
- Subscription, scheduler, and invalidation controllers expose narrow lifecycle callbacks.
- Only the central diagnostic emitter invokes the configured public sink.

No collector, metrics state, snapshot schema, redaction policy, or devtools protocol is added.

## Behavioural coverage

New tests cover:

- explicit target and dependency reason propagation;
- fresh skip and active-attempt reuse distinction;
- subscription to scheduler to load causality;
- context invalidation and subscribed reload;
- queue admission and queued cancellation before loader invocation;
- failed loads and blocked descendants;
- preservation of the M10A foundation event tests with the expanded event stream.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of the core public entry passed with the available global compiler.
- Strict TypeScript compilation of the diagnostics test set passed using a local Vitest declaration shim.
- Static inspection confirmed diagnostic support remains framework-agnostic and the emitter remains the only sink invocation point.

Project dependencies were unavailable, so the complete repository type check, Vitest suite, and production build were not run or claimed.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M10B was validated successfully against the combined checkout during Milestone 10 closure.

## Completion

M10B is complete and was validated as part of the successful combined Milestone 10 offline verification.
