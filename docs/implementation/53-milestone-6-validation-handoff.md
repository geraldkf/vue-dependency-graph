# Milestone 6: Final Validation Handoff

## Status

Ready for final automated and manual validation.

## Purpose

This is the authoritative validation checklist for closing Milestone 6. Earlier M6A through M6E notes remain point-in-time implementation records.

## Automated validation

Run from the repository root with the committed dependencies and lockfile:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Record the exact outcome and final test count. Any failure keeps Milestone 6 in `Validation pending` status.

## Expected automated coverage

The complete suite should cover:

- existing graph, runtime, execution, scheduler, transaction, Vue, Pinia, and playground behaviour;
- typed event definitions and payload inference;
- event declaration validation and indexing;
- immediate matching and non-matching publication;
- predicate-failure atomicity;
- event invalidation, scheduling, and execution races;
- transaction event staging, commit, rollback, overlap, and settlement;
- Typed Events playground matching, no-match, commit, rollback, reset, and unmount behaviour.

## Manual playground validation

Start the playground:

```text
pnpm dev
```

Complete the **Typed Events** checklist in `docs/PLAYGROUND.md`.

Minimum acceptance observations:

1. Initial capability status loads once for job seeker `101`.
2. A matching appointment event causes exactly one additional capability request.
3. A non-matching appointment event causes no request.
4. A staged transaction event produces no request before commit.
5. Commit produces exactly one request and returns the node to `success / fresh`.
6. Rollback produces no request and displays the rollback outcome.
7. Reset restores request `1`, phase `idle`, outcome `ready`, and empty history.
8. Switching tabs with an open event transaction produces no warning and returns to a clean scenario.
9. Existing playground scenarios continue to behave normally.

## Exit criterion

Milestone 6 is complete only when this statement is demonstrated:

> Appointment events invalidate capability status without either store importing the other.

The implementation establishes this boundary through `appointments-domain.ts` and `typed-events-nodes.ts`. Manual validation confirms the observable integration behaviour.

## Status updates after success

After successful validation:

- change Milestone 6 in `docs/implementation/01-roadmap.md` to `Complete and validated`;
- mark M6A through M6F validation items complete;
- update `README.md` and `docs/ROADMAP.md` to identify Milestone 7 as next;
- update `docs/decisions/ADR-006-domain-events.md` to `Implemented and validated`;
- replace validation-pending wording in `docs/implementation/52-milestone-6-implementation-summary.md`;
- append the validation date, command outcomes, test count, build outcome, and manual checklist outcome to this handoff.

Do not invent test totals or validation outcomes. Record only results reported from the final combined repository run.
