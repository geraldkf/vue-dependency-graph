# Runtime and Execution Implementation Note

## Status

Validation pending.

Milestone 2 implementation, tests, and documentation were prepared and statically inspected in the contained environment. Type checking, Vitest, build, and playground startup were not run.

## Files changed

### Core source

- `src/core/execution.ts`
- `src/core/runtime.ts`
- `src/core/index.ts`

### Tests

- `tests/core/execution-failure.spec.ts`
- `tests/core/execution-order.spec.ts`
- `tests/core/runtime-context.spec.ts`
- `tests/core/runtime-deduplication.spec.ts`
- `tests/core/runtime-races.spec.ts`
- `tests/core/runtime-state.spec.ts`
- `tests/core/runtime-types.test.ts`
- `tests/core/test-helpers.ts`

### Documentation

- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/07-runtime-execution-implementation-note.md`
- `docs/implementation/prompts/003-implement-runtime-state-and-execution.md`

## Runtime state model

Runtime state is stored by node key in each runtime instance. Definitions remain immutable and reusable. Status and freshness are separate. Derived values are `undefined` before first success.

## Execution semantics

- Execution is explicit in Milestone 2.
- Requested nodes include required transitive ancestors.
- Fresh successful nodes are reused.
- Independent parents run concurrently.
- Same-generation work is deduplicated per runtime.
- Data loaders receive an attempt-scoped abort signal.
- Derived nodes execute synchronously after successful fresh parents.
- Context changes invalidate and abort affected descendants without auto-execution.
- Generations and attempt tokens discard obsolete results.

## Failure semantics

- Direct failures update node state.
- Refresh failures retain previous successful data.
- Dependent nodes are blocked.
- Independent branches continue.
- `GraphExecutionError` aggregates failed and blocked nodes after executable branches settle.
- Abort and superseded results are not business errors.

## Static checks

Static checks cover JSON parsing, logical boundaries, forbidden imports, public exports, explicit `any`, console logging, later-milestone modules, state separation, test coverage categories, and archive contents.

These checks do not establish TypeScript correctness or passing tests.

## Offline validation

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

Return full failure output and confirm the playground still renders.

## Risks and questions for Milestone 3

- Compiler feedback may require narrow generic adjustments around runtime state and typed dependency getters.
- Milestone 3 must schedule the explicit execution engine rather than duplicate execution logic.
- Demand release will need clear interaction with active attempts and graph-level observation.
- Explicit refresh and prefetch semantics should build on freshness and generation behaviour already implemented.
