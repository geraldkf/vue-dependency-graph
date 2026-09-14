# Milestone 8C: Fixed Interval While Subscribed

## Status

Complete and validated as part of the combined Milestone 8 checkout.

## Scope

M8C activates `refreshInterval(...)` for subscribed data nodes. It extends the M8B runtime policy controller without introducing another timer service, execution path, cache, or scheduler.

Retry metadata remains definition-only in M8C. Retry, backoff, jitter, pause/resume, poll-until conditions, timeout, and playground behaviour remain deferred to later Milestone 8 slices.

## Runtime behaviour

After a subscribed interval node reaches successful fresh state, the runtime schedules one timeout for `intervalMs`.

When the timeout expires:

- the controller rechecks the session token, node generation, success, freshness, and subscription ownership;
- it delegates to the existing policy-owned refresh operation;
- the existing refresh preparation advances generation and preserves successful data;
- execution uses the existing loader, cancellation, active-attempt sharing, and runtime-wide concurrency limiter;
- no next interval is scheduled while the request is active;
- after successful policy work fully settles, a new full interval begins;
- after failure, no new interval is scheduled until an external successful execution establishes a fresh value.

Recursive timeout scheduling is used instead of `setInterval(...)`, preventing slow loads from overlapping later ticks.

## Session lifecycle

Interval sessions are runtime-local and generation-aware.

- Final unsubscribe clears the timer and resets interval timing.
- Resubscription starts a clean full interval from the current successful value.
- Context or event invalidation clears the old timer and generation state.
- Successful reload for the new generation starts a new full interval.
- Manual refresh success restarts the interval from the new settled result.
- Separate runtimes created from one graph own independent sessions and timers.

Stale-after behaviour remains unchanged. Unlike interval policy, stale-after retains its successful timestamp across an unsubscribed gap so resubscription can use the remaining age.

## Settlement guard

M8C records whether a policy-owned refresh operation is still settling. Execution commits successful node state before the operation controller releases its shared operation promise. Without this guard, a zero-time or immediately advanced test clock could consume the next timer while the previous operation was still registered and accidentally join completed work.

The controller therefore schedules the next interval only after the policy-owned refresh promise settles. This keeps the interval measured from settled completion and preserves operation sharing.

## Files added

- `tests/core/refresh-policy-interval.spec.ts`
- `docs/implementation/82-milestone-8c-fixed-interval-implementation-note.md`

## Files updated

- `src/core/refresh-policies/policy-controller.ts`
- `README.md`
- `docs/README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/78-milestone-8-refresh-polling-plan.md`
- `docs/testing/01-test-strategy.md`

## Behavioural coverage prepared

The fixed-interval suite covers:

- repeated refresh after each successful settled attempt;
- no overlapping request while a policy loader remains active;
- no timer while policy work is active;
- one full interval after successful settlement;
- final-unsubscribe timer cleanup;
- a clean full interval after resubscription;
- interval restart after context invalidation and scheduler reload;
- independent sessions across runtimes sharing one graph definition.

Existing M8B coverage continues to protect stale-after age retention, automatic-only cancellation, and shared manual-refresh ownership.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of `src/core/**/*.ts` passed.
- Focused strict TypeScript compilation of the interval behavioural suite passed using the available compiler and a minimal Vitest declaration stub.
- A compiled smoke scenario confirmed repeated interval refresh, no overlap during a slow load, scheduling after settlement, and timer cleanup.
- Documentation links and changed-file ZIP integrity were checked.

The exact repository command suite subsequently passed against the combined Milestone 8 checkout.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Do not mark M8C validated until all four commands pass against the combined checkout.

No manual playground validation is required because M8C does not add or change a playground scenario.

## Next task

After offline M8C validation, proceed with M8D: poll-until completion, business failure, timeout, generation-scoped sessions, and terminal policy errors.
