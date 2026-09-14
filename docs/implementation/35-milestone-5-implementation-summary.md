# Milestone 5: Atomic Transactions Implementation Summary

## Status

Implementation prepared. Automated repository and manual browser validation pending.

## Delivered capability

`runtime.transaction(work)` now provides atomic local context updates rather than notification deferral alone.

While transaction work is open:

- context writes are staged by registered context key;
- only the final staged value for each context is retained;
- `runtime.getState(...)` continues to return committed state;
- descendants, generations, attempts, observers, and scheduling remain unchanged by staged context values;
- nested transactions share one outer staging scope;
- explicit execute, prefetch, and refresh operations are rejected.

At successful outer completion:

- unchanged or reverted final values are removed with `Object.is`;
- effective context values commit together;
- changed context generations advance once;
- the transitive descendant union is deduplicated across roots and diamond paths;
- each affected descendant is invalidated once;
- affected generations advance once;
- affected active attempts are aborted after generation advancement;
- one observer notification is emitted;
- at most one automatic scheduler pass is requested;
- transaction-time settlement waits through resulting scheduler work.

At failed outer completion:

- synchronous throws and asynchronous rejections discard staged context values;
- no context invalidation, generation change, abort, notification, or scheduling occurs;
- the original error remains caller-visible;
- independent runtime work remains committed and its buffered notification is released;
- transaction-time settlement resolves without phantom work.

## Execution race model

Execution attempts started before a transaction remain independent committed work.

A result committed before context commit is preserved as stale successful data if the node becomes affected. A result completing after generation advancement is obsolete and cannot overwrite committed state, even if its loader ignores abort.

Execution writes are not staged in the context transaction overlay.

## Capability boundaries

- `transactions/transaction-coordinator.ts` owns transaction lifecycle, staged context values, nested scope, operation guards, successful commit, and failed discard.
- `transactions/notification-buffer.ts` remains dispatch and settlement deferral only.
- `invalidation/invalidation.ts` owns effective context reconciliation, commit-wide descendant collection, generation changes, abort ordering, notification, and scheduler request decisions.
- `execution/execution.ts` retains normal generation and token race protection.
- `runtime.ts` remains the explicit composition root.

No savepoints, manual transaction objects, public staged reads, isolation levels, or backend rollback were added.

## Test coverage

Core transaction tests cover:

- committed reads while open;
- final-value staging and reverted no-ops;
- async and nested transactions;
- coalesced shared and diamond invalidation;
- generation and abort ordering;
- successful and failed settlement;
- synchronous and asynchronous rollback;
- propagated and caught nested failures;
- independent execution during rollback;
- completion before and after generation advancement;
- ignored-abort protection;
- operation guards;
- unchanged immediate behaviour outside transactions.

The playground adds a deterministic Atomic Transaction scenario and component test proving intermediate related values are not observer-visible.

## Validation completed in the contained environment

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Both passed. The TypeScript command is a temporary strict check over `src/core/**/*.ts`.

## Validation pending

Run in the normal repository environment:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Then run the playground and complete the Atomic Transaction manual validation in `docs/PLAYGROUND.md`.

Do not mark Milestone 5 validated or complete until these results are reported successfully.
