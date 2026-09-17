# TOI-8F Final Validation Handoff

## Status

Prepared. Partial contained validation passed. Repository and manual validation remain pending.

## Contained validation completed

The following checks passed in the contained environment:

```text
node scripts/check-boundaries.mjs
```

Result:

```text
Core boundary check passed.
```

A standalone strict TypeScript check over `src/core/**/*.ts` also passed using the available global TypeScript compiler.

This standalone check is supplementary. It does not replace the repository's pinned `vue-tsc` typecheck.

## Validation not runnable in the contained workspace

The stored workspace does not contain `node_modules`. The repository pins `pnpm@12.4.1`, Vue 3.5.13, Vitest 3.0.7, and `vue-tsc` 2.2.8. Without installed dependencies, the contained environment cannot truthfully run:

```text
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

Do not mark TOI complete until these commands and the manual playground matrix pass in the repository environment.

## Required automated validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

If a focused failure occurs, run these suites directly before repeating the full suite:

```text
pnpm test:run tests/core/transaction-handle.spec.ts --reporter verbose --no-color
pnpm test:run tests/core/transaction-context-isolation.spec.ts --reporter verbose --no-color
pnpm test:run tests/core/transaction-event-isolation.spec.ts --reporter verbose --no-color
pnpm test:run tests/core/transaction-operation-isolation.spec.ts --reporter verbose --no-color
pnpm test:run tests/core/transaction-conflicts.spec.ts --reporter verbose --no-color
pnpm test:run tests/core/transaction-overlap.spec.ts --reporter verbose --no-color
pnpm test:run tests/playground/scenarios/atomic-transaction.spec.ts --reporter verbose --no-color
pnpm test:run tests/playground/scenarios/typed-events.spec.ts --reporter verbose --no-color
```

## Automated acceptance matrix

Confirm all of the following:

### Handle and staging

- `GraphTransaction` remains publicly exported.
- Callback result inference remains intact.
- Context and event payload typing remains intact.
- Closed handles reject use after commit, rollback, predicate failure, and group closure.
- Staged values and events remain hidden before commit.
- Rollback discards only handle-owned work.

### Context isolation

- Plain context writes commit while another transaction is open.
- Immediate writes notify observers and schedule subscribed dependants before transaction closure.
- Immediate writes survive transaction rollback.
- Same-context independent writes reject transaction commit atomically.
- Conflict preserves independent values and applies no other staged context or event effect.

### Event isolation

- Plain event publication applies while another transaction is open.
- Immediate event invalidation and subscribed reload complete before transaction closure.
- Immediate event effects survive staged transaction rollback.
- Handle-owned publications preserve order and final-context predicate semantics.

### Caller operations

- `execute`, `prefetch`, and `refresh` remain available while another transaction is open.
- They read committed context state.
- Their completion notification is independent of the transaction buffer.
- Generation and attempt-token race protections remain intact.

### Settlement and overlap

- `runtime.whenSettled()` observes ordinary scheduler work directly.
- Callers awaiting transaction-triggered work await the transaction before settlement.
- Explicit overlapping transaction calls continue joining one group.
- Root outcome and participant settlement remain unchanged.

### Playground

- Atomic Transaction existing commit and rollback flows still pass.
- Unrelated context work becomes visible before closure and survives rollback.
- Same-context conflict exposes no partial staged snapshot.
- Typed Events existing matching, non-matching, commit, and rollback flows still pass.
- Unrelated event work completes before closure and survives rollback.
- Reset and unmount paths remain deterministic.

## Manual playground validation

Start the playground:

```text
pnpm dev
```

### Atomic Transaction: unrelated context

1. Start the transaction.
2. Confirm phase `first-staged` and committed values `1 + 10`.
3. Select **Apply unrelated runtime update**.
4. Confirm unrelated context and dependent result become `999` before transaction closure.
5. Stage the second value and roll back.
6. Confirm transaction-owned values remain `1 + 10`.
7. Confirm unrelated values remain `999`.

### Atomic Transaction: conflict

1. Reset and start the transaction.
2. Select **Apply conflicting runtime update**.
3. Confirm committed values become `999 + 10`.
4. Stage the second value and commit.
5. Confirm phase `conflicted` and outcome `conflict rejected`.
6. Confirm conflict key `atomic-transaction-first`.
7. Confirm values remain `999 + 10` and no partial `999 + 20` state appears.

### Typed Events: unrelated publication

1. Start the event transaction.
2. Confirm the appointment event remains staged and capability requests do not advance.
3. Select **Publish unrelated event now**.
4. Confirm the unrelated target reloads before transaction closure.
5. Roll back the appointment event transaction.
6. Confirm capability requests remain unchanged.
7. Confirm the unrelated result remains committed.

### Lifecycle

1. Start and pause each transaction scenario.
2. Switch tabs or unmount the scenario.
3. Confirm no unresolved gate, post-unmount Vue warning, or console error.
4. Return to each scenario and confirm deterministic initial state.
5. Use Reset after context isolation, conflict, and event isolation flows.
6. Confirm all displayed values, counts, outcomes, history, and controls return to their initial state.

## Completion rule

Mark TOI complete only after:

- boundary check passes;
- repository `vue-tsc` typecheck passes;
- full Vitest suite passes;
- production build passes;
- manual Atomic Transaction and Typed Events validation passes;
- no Vue warnings or console errors occur;
- the roadmap and this handoff are updated with the validation date and result.
