# Milestone 9G: Documentation, Migration Guidance, and Validation

## Status

Documentation and migration guidance are complete. Full repository validation and manual browser verification remain pending on the combined checkout.

## Reconciled documentation

Milestone 9 behaviour is now described consistently across:

- the public API reference;
- mutation architecture and cache semantics;
- ADR-013;
- the implementation roadmap and slice notes;
- the playground guide;
- the test strategy;
- the mutation adoption guide.

Maintained documentation no longer describes the mutation framework as merely planned.

## Adoption guidance

`docs/guides/04-mutation-adoption.md` covers:

- choosing direct update, invalidation, or typed event publication;
- adding optimistic behaviour only for already-successful data;
- distinguishing known rejection from unknown remote outcome;
- application-owned idempotency keys;
- authoritative reload after ambiguity or rollback conflict;
- framework error handling;
- transaction and Vue usage boundaries.

The framework intentionally does not generate idempotency keys, infer transport semantics, retry commands, provide offline queues, or layer optimistic writes on one node.

## Validation evidence available

Contained-environment validation completed during M9A through M9F includes core boundary checks, strict core TypeScript checks, focused mutation type and behavioural-test compilation with a local Vitest declaration shim, non-SFC playground-model type checks, Markdown and internal-link checks, and ZIP integrity checks.

A user-provided dependency-backed Vitest run after M9E executed 357 tests. It reported 355 passing and two focused failures. The classifier fallback implementation and one brittle message assertion were corrected afterward. That run did not include M9F, so it is evidence of broad compatibility but is not final Milestone 9 validation.

## Required automated validation

Run from the repository root against the cumulative M9G checkout:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Record the actual exit code and output summary for each command. Do not mark Milestone 9 complete if any command fails.

## Required manual playground validation

Open the Optimistic Appointment Booking scenario and verify:

1. Initial appointments and capability status load successfully.
2. Start booking immediately shows one pending appointment and one request.
3. Confirm success replaces pending status with confirmed status and reloads capability status once.
4. Reject booking removes the pending appointment and reports rollback.
5. Make outcome unknown reports ambiguity and reloads authoritative appointments.
6. Start overlapping booking rejects the second optimistic attempt without incrementing the request count.
7. Reset restores the baseline appointment, counters, labels, status, and freshness.
8. Changing tabs with a request pending produces no Vue warning and leaves no unresolved harness request.

## Closure rule

After automated and manual validation pass, update:

- M9A through M9G roadmap items to complete;
- Milestone 9 status to complete;
- the latest validation evidence with actual command totals;
- the next-task pointer to Milestone 10 observability.

Until then, the implementation is prepared and documented but validation remains pending.
