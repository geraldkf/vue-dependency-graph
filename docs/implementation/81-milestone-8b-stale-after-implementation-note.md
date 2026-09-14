# Milestone 8B: Runtime Policy Controller and Stale-After Behaviour

## Status

Complete and validated as part of the combined Milestone 8 checkout.

## Scope

M8B activates only `staleAfter(...)`. Interval refresh, poll-until conditions, retry, backoff, jitter calculation, pause/resume behaviour, browser lifecycle integration, and playground work remain deferred.

## Runtime environment

`GraphRuntimeOptions` now accepts an optional `refreshPolicyEnvironment`. The environment supplies clock, timer, randomness, and future pause/resume seams without importing browser APIs into core. The default environment uses platform timers, `Date.now()`, and `Math.random()` and is never paused.

Tests inject a deterministic environment. M8B uses only `now`, `setTimeout`, and `clearTimeout`; later slices consume the remaining seams.

## Runtime policy controller

Added `src/core/refresh-policies/policy-controller.ts`.

The controller:

- discovers stale-after data nodes from immutable graph definitions;
- owns one runtime-local session per policy node;
- reacts to committed runtime notifications;
- schedules one timer after a subscribed node reaches successful fresh state;
- retains the successful timestamp across an unsubscribed gap;
- uses the remaining duration when the node is resubscribed;
- clears timers when the node becomes stale, starts loading, fails, or loses final subscription ownership;
- validates session token, generation, successful state, freshness, and subscription ownership again inside every timer callback;
- catches policy-owned refresh rejection to prevent unhandled promises.

No policy state is stored on graph definitions or mirrored into Pinia.

## Policy-owned refresh

The existing operations controller now exposes one internal `refreshPolicyNode(...)` operation. It reuses normal refresh preparation and the single execution controller with a new internal `refresh-policy` origin.

Manual and policy refreshes for the same target set share the existing operation promise. When a manual caller joins policy work, the active attempt records caller ownership and is protected from final-unsubscribe cancellation.

Changed successful policy refresh results reuse the same descendant invalidation path as manual refresh.

## Cancellation ownership

The previous scheduler-only cancellation predicate is generalized to automatic-only ownership. An attempt is automatic-only when all of its origins are `scheduler` or `refresh-policy`.

Final unsubscribe:

- clears the policy timer through the committed subscription notification;
- aborts active automatic-only work;
- preserves work also owned by explicit execution, prefetch, or manual refresh.

Existing generation and token protection continues to reject late ignored-abort results.

## Files added

- `src/core/refresh-policies/environment.ts`
- `src/core/refresh-policies/policy-controller.ts`
- `tests/core/refresh-policy-stale-after.spec.ts`
- `docs/implementation/81-milestone-8b-stale-after-implementation-note.md`

## Files updated

- `src/core/refresh-policies/types.ts`
- `src/core/state/state.ts`
- `src/core/execution/execution.ts`
- `src/core/operations/operations.ts`
- `src/core/runtime.ts`
- `src/core/index.ts`
- `tests/core/runtime-types.test.ts`
- `README.md`
- `docs/README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/78-milestone-8-refresh-polling-plan.md`
- `docs/testing/01-test-strategy.md`

## Behavioural coverage prepared

The stale-after suite covers:

- initial subscription loading followed by one timer;
- refresh only after the full duration;
- a new timer after successful policy refresh;
- remaining freshness duration after unsubscribe and resubscribe;
- final-unsubscribe timer cleanup;
- automatic-only attempt cancellation;
- preservation of shared manual refresh work.

Runtime compile-time coverage confirms the environment can be supplied through `GraphRuntimeOptions`.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of `src/core/**/*.ts` passed.
- Focused compile-time policy and runtime-option tests passed with the available compiler.
- Documentation links and ZIP integrity were checked.

The exact repository command suite subsequently passed against the combined Milestone 8 checkout.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Do not mark M8B validated until all four commands pass against the combined checkout.

## Next task

After offline M8B validation, proceed with M8C: fixed interval while subscribed with recursive, non-overlapping scheduling.
