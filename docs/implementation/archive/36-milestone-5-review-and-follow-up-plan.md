# Milestone 5: Code Review and Follow-up Plan

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Review and follow-up work completed. Final automated repository and manual playground validation were reported successful on 14 September 2026. No runtime correctness defect remains open for Milestone 5.

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

No further runtime refactor is required before Milestone 6.

The current capability boundaries remain appropriate:

- the transaction coordinator owns lifecycle and staged context values;
- the notification buffer owns dispatch and settlement deferral;
- invalidation owns commit reconciliation and graph effects;
- execution owns attempt completion and obsolete-result protection;
- runtime remains the composition root.

Changing these boundaries before validation would add risk without correcting an observed defect.

## Recommended follow-up: M5H transaction hardening and test organisation

M5H was completed and included in the final successful Milestone 5 validation.

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

Prepared with offline automated and manual browser validation pending. Open transactions are released without post-unmount reactive updates, and reset now restores both related context values atomically before clearing scenario counters.

Implementation details: `docs/implementation/40-milestone-5h4-playground-lifecycle-note.md`.

### M5H.6 Transaction progress and rollback playground

#### M5H.6A Transaction progress display

Prepared with offline validation pending. The playground now separates committed runtime state from a scenario-local transaction draft, exposes first-staged and second-staged phases, and shows a local preview before atomic commit.

Implementation details: `docs/implementation/42-milestone-5h6a-transaction-progress-playground-note.md`.

#### M5H.6B Error-driven rollback

Prepared with offline validation pending. The playground now offers commit and rollback-with-error decisions after both values are staged, displays outcome and rollback error, and proves the committed graph and observer history remain unchanged after rollback.

Implementation details: `docs/implementation/43-milestone-5h6b-error-rollback-playground-note.md`.

#### M5H.6C Playground validation coverage and handoff

Prepared with offline validation pending. Five focused component tests now cover progress, commit, rollback, unmount, and reset-after-rollback, and the final validation handoff reflects both commit and rollback manual paths.

Implementation details: `docs/implementation/44-milestone-5h6c-playground-validation-coverage-note.md`.

### M5H.5 Documentation reconciliation and validation handoff

Prepared. Historical transaction documentation now points to the current implementation and focused test suites, and one authoritative final validation and result-recording checklist is available.

Implementation details: `docs/implementation/41-milestone-5h5-validation-handoff.md`.

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
