# Milestone 8E: Retry, Backoff, Jitter, Pause, and Resume

## Status

Complete and validated as part of the combined Milestone 8 checkout.

## Scope

M8E completes the refresh-policy runtime lifecycle planned before the playground slice. It adds bounded retries for interval and polling policies, deterministic fixed and exponential backoff, proportional jitter, pause/resume timer handling, active-time polling timeout accounting, retry exhaustion errors, and an optional browser environment adapter.

`staleAfter(...)` does not retry automatically. Retry applies only to policy-owned interval and poll-until load failures. Manual refresh, prefetch, explicit execution, and scheduler behaviour are unchanged.

## Retry behaviour

`maxRetries` counts retries after the failed policy attempt. Retry counters reset after successful policy work, a new external generation, final unsubscribe, or a clean session restart.

Fixed retry uses `delayMs`. Exponential retry uses:

```text
min(initialDelayMs * multiplier ** retryIndex, maxDelayMs)
```

Jitter applies:

```text
baseDelay * (1 - jitterRatio + 2 * jitterRatio * random())
```

The result is rounded and clamped to zero or greater. The environment random source is not called when jitter is zero.

When configured retries are exhausted, the runtime commits `GraphRefreshRetryExhaustedError`. It exposes the node key, total failed attempt count, and original load failure as `cause`. Existing successful data remains available with stale freshness.

Without retry metadata, a failed policy attempt remains suspended until an external successful operation establishes fresh state.

## Pause and resume

The policy controller subscribes to the injected environment pause signal.

On pause:

- pending timers are cleared;
- each timer's remaining delay and purpose are retained;
- no new policy attempt starts;
- active loaders are not aborted solely because of pause;
- poll timeout active time stops advancing.

On resume:

- duplicate lifecycle notifications are ignored;
- subscription ownership and terminal state are rechecked;
- one timer is restored using the retained delay;
- missed interval ticks are not replayed;
- paused duration is excluded from polling timeout.

Final unsubscribe resets interval, polling, and retry sessions even while paused.

## Browser environment

The Vue entry point exports `createBrowserRefreshPolicyEnvironment(...)`. By default it pauses policies while the document is hidden or the browser reports offline. Either signal can be disabled independently.

The adapter coalesces visibility and online state into one pause value and returns cleanup from `onPauseChange(...)`. Core remains free of browser, Vue, and Pinia imports.

## Files added

- `src/vue/browser-refresh-policy-environment.ts`
- `tests/core/refresh-policy-retry-pause.spec.ts`
- `tests/vue/browser-refresh-policy-environment.spec.ts`
- `docs/implementation/84-milestone-8e-retry-pause-resume-implementation-note.md`

## Files updated

- `src/core/refresh-policies/errors.ts`
- `src/core/refresh-policies/policy-controller.ts`
- `src/core/index.ts`
- `src/vue/index.ts`
- `README.md`
- `docs/README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/07-vue-and-pinia-integration.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/78-milestone-8-refresh-polling-plan.md`
- `docs/testing/01-test-strategy.md`

## Coverage prepared

Core tests cover fixed retry, capped exponential backoff, deterministic jitter, zero-jitter random avoidance, retry reset, exhausted retry state, pause with remaining delay, coalesced resume, no requests while paused, and active-time polling timeout.

Vue adapter tests cover hidden and offline defaults, signal opt-out, combined-state coalescing, and listener cleanup.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of core passed.
- Focused strict TypeScript compilation of refresh-policy suites passed.
- Compiled smoke scenarios for M8B, M8C, M8D, and M8E passed.
- Documentation links and changed-file ZIP integrity were checked.

The exact repository command suite subsequently passed against the combined Milestone 8 checkout.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Do not mark M8E validated until all four commands pass against the combined checkout.

## Next task

After offline M8E validation, proceed with M8F: the deterministic Polling Progress playground and Vue Testing Library coverage.
