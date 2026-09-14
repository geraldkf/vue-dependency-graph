# Milestone 8D: Poll-Until Completion, Failure, and Timeout

## Status

Complete and validated as part of the combined Milestone 8 checkout.

## Scope

M8D activates `pollUntil(...)` for subscribed data nodes. It adds typed completion and business-failure evaluation, active polling timeout, generation-scoped polling sessions, terminal policy errors, and stale-success preservation.

Retry metadata remains definition-only. Retry, backoff, jitter, pause/resume, browser lifecycle integration, and the Polling Progress playground remain deferred to later Milestone 8 slices.

## Polling lifecycle

A polling session begins when a subscribed poll-enabled node first reaches successful fresh state. The runtime evaluates that committed value before scheduling another request.

For each successful value, evaluation order is fixed:

1. Evaluate `failWhen(...)` when supplied.
2. Evaluate `stopWhen(...)`.
3. Check elapsed timeout.
4. Schedule one recursive timeout for the next poll.

The initial subscription load, policy-owned poll results, and external successful refresh or dependency reload results are evaluated. Each generation is evaluated at most once.

Policy-owned refresh generations remain part of one polling cycle, preserving the original polling start time. An external invalidation or manual refresh starts a clean cycle from the new successful value.

## Completion

When `stopWhen(...)` returns true:

- the latest successful value remains committed;
- node status remains `success` and freshness remains `fresh`;
- no terminal error is added;
- the timer is cleared and no further poll is scheduled.

## Business failure and predicate failure

When `failWhen(...)` returns true, the runtime commits `GraphPollingConditionError` for the current generation.

If either predicate throws, the runtime commits `GraphPollingConditionError` with the thrown value exposed through `Error.cause`. Predicate failure is atomic from the policy perspective: no timeout or subsequent poll is scheduled after the exception.

Failure is intentionally checked before completion. If malformed data satisfies both predicates, the business-failure result wins.

## Timeout

`GraphPollingTimeoutError` includes the node key and configured timeout. M8D measures elapsed time from the first successful value in the current polling cycle. Timeout is checked after each successful intermediate result.

Pause-aware active time is deferred to M8E. M8D therefore uses the injected monotonic environment clock directly.

## Terminal state transition

Terminal polling failures use one generation-checked runtime transition:

- verify the current generation still matches the evaluated result;
- preserve the latest successful data;
- set status to `error`;
- set freshness to `stale`;
- store the terminal policy error;
- preserve `hasSuccessfulValue`;
- notify observers once;
- schedule no further policy work.

Late obsolete attempts cannot commit data or terminal policy state because existing attempt-token checks and the terminal transition generation check both apply.

## Session closure

The current polling session stops on:

- completion;
- business failure;
- predicate exception;
- timeout;
- final unsubscribe;
- dependency or event invalidation;
- obsolete policy-owned work superseded by a newer generation.

Final unsubscribe clears timers and all polling session metadata. A future subscription creates a clean session from the then-current committed value.

## Public errors

M8D exports:

```ts
GraphPollingConditionError
GraphPollingTimeoutError
```

Both errors expose `nodeKey`. Timeout errors also expose `timeoutMs`.

## Files added

- `src/core/refresh-policies/errors.ts`
- `tests/core/refresh-policy-polling.spec.ts`
- `docs/implementation/83-milestone-8d-poll-until-implementation-note.md`

## Files updated

- `src/core/refresh-policies/policy-controller.ts`
- `src/core/runtime.ts`
- `src/core/index.ts`
- `README.md`
- `docs/README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/78-milestone-8-refresh-polling-plan.md`
- `docs/testing/01-test-strategy.md`

## Behavioural coverage prepared

The polling suite covers:

- deterministic intermediate progress followed by completion;
- no requests after completion;
- business failure with latest successful data retained;
- failure-before-completion ordering;
- timeout with latest successful data retained;
- predicate exception and cause preservation;
- dependency invalidation while policy work is active;
- late obsolete result protection;
- final-unsubscribe timer cleanup.

Existing M8B and M8C suites continue to cover stale-after and interval behaviour.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of `src/core/**/*.ts` passed.
- Focused strict TypeScript compilation of the polling behavioural suite passed using the available compiler and a minimal Vitest declaration stub.
- A compiled smoke scenario confirmed completion and timeout behaviour, retained progress data, and timer cleanup.
- Existing stale-after and interval focused TypeScript suites remained valid.
- Documentation links and changed-file ZIP integrity were checked.

The exact repository command suite subsequently passed against the combined Milestone 8 checkout.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Do not mark M8D validated until all four commands pass against the combined checkout.

No manual playground validation is required because M8D does not add or change a playground scenario.

## Next task

After offline M8D validation, proceed with M8E: retry, fixed and exponential backoff, bounded jitter, pause/resume, active-time timeout accounting, and optional Vue/browser environment integration.
