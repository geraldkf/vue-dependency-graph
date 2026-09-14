# Milestone 5: Code Review and Follow-up Plan

## Status

Review completed after the first offline unit-test run. One test integration issue was fixed. No runtime correctness defect was found in the reported test output.

## Unit-test issue fixed

The playground shell test expects each scenario tab label to match the scenario's primary heading. The new tab was labelled `Atomic Transaction`, while its heading was `Atomic Context Transaction`.

The scenario heading now uses `Atomic Transaction`, matching the existing shell-test convention and preserving the more detailed explanation in the scenario body.

## Milestone 5 implementation review

Reviewed:

- transaction coordinator lifecycle and context staging;
- notification-buffer interaction;
- context registration and final-value reconciliation;
- descendant collection and diamond deduplication;
- generation advancement and abort ordering;
- execution completion before and after commit;
- rollback and independent runtime activity;
- scheduler settlement;
- operation guards;
- core transaction tests;
- playground scenario and component tests;
- maintained architecture, API, roadmap, ADR, and test documentation.

### Findings

No mandatory runtime refactor is recommended before offline validation.

The current capability boundaries remain appropriate:

- the transaction coordinator owns lifecycle and staged context values;
- the notification buffer owns dispatch and settlement deferral;
- invalidation owns commit reconciliation and graph effects;
- execution owns attempt completion and obsolete-result protection;
- runtime remains the composition root.

Changing these boundaries before validation would add risk without correcting an observed defect.

## Recommended follow-up: M5H transaction hardening and test organisation

M5H is recommended after Milestone 5 validation. It is not a blocker for the current offline validation pass.

### M5H.1 Define overlapping transaction-call semantics

Implemented with offline validation pending. Overlapping calls join one transaction group, the first call is the root, all participants must settle before the group closes, and the root outcome controls commit or rollback.

Implementation details: `docs/implementation/37-milestone-5h1-overlapping-transactions-implementation-note.md`.

### M5H.2 Split the transaction test suite

Prepared with offline validation pending. The original 29 tests are now grouped into six focused suites for staging, invalidation, rollback, settlement, execution races, and overlapping calls. No runtime behaviour or assertion changed.

Implementation details: `docs/implementation/38-milestone-5h2-transaction-test-organisation-note.md`.

### M5H.3 Review internal transaction contracts

Prepared with offline validation pending. Notification-buffer transaction-state inspection was removed, the accidental pre-release `RuntimeNotificationBuffer` public type export was removed, and the coordinator and invalidation controller now share one internal `ContextChange` type.

Implementation details: `docs/implementation/39-milestone-5h3-internal-transaction-contracts-note.md`.

### M5H.4 Playground lifecycle polish

Review the Atomic Transaction scenario after manual browser validation:

- confirm leaving the tab while the transaction is open releases the awaited gate cleanly;
- confirm no post-unmount warning is emitted when the transaction promise settles;
- confirm reset behaviour and derivation count are understandable to a user;
- add only the smallest lifecycle change required by observed browser behaviour.

## Validation workflow

Apply the heading fix, then rerun:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

If those pass, complete the Atomic Transaction manual playground steps in `docs/PLAYGROUND.md`.

M5H should begin only after the validation results are recorded, unless validation exposes a related defect.
