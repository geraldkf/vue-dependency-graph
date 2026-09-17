# Milestone 8F: Polling Progress Playground

## Status

Complete and validated as part of the combined Milestone 8 checkout.

## Scenario

M8F adds a deterministic **Polling Progress** tab to the playground. The scenario owns an isolated runtime because it requires a controllable clock and pause signal rather than the default platform environment used by the shared Pinia playground runtime.

The displayed state includes:

- operation identifier;
- progress percentage and business state;
- runtime status, freshness, and terminal error type;
- total and active request counts;
- maximum concurrent requests;
- retry attempt;
- next scheduled delay;
- outstanding timer count;
- mounted consumer and active/paused lifecycle state.

## Controls

The scenario provides controls to mount and unmount the consumer, advance one deterministic poll, complete, fail, trigger timeout, fail the next request, pause, resume, and reset.

No control waits on wall-clock time and no response is random. The scenario's virtual environment advances only when a user action requests it.

## Demonstrated behaviour

- Initial load and each poll advance through a fixed progress sequence.
- Maximum concurrent request count remains one.
- Completion stops polling with fresh successful data.
- Business failure stops polling while retaining the latest progress.
- Timeout stops polling while retaining the latest progress.
- A transient request failure exposes retry attempt one and a deterministic 500 ms delay.
- Pause clears the active timer and prevents polling.
- Resume restores one remaining delay without replaying missed ticks.
- Unmount removes subscription ownership and clears policy timers.
- Reset creates a clean runtime with zero requests and zero timers.
- Switching away from the tab invokes component cleanup for the subscription and runtime observer.

## Structure

`polling-progress-model.ts` contains the deterministic harness and graph definition. `PollingProgressScenario.vue` contains presentation and user interaction only. The model uses the real graph runtime and refresh-policy implementation rather than duplicating polling behaviour in Vue state.

## Files added

- `src/playground/scenarios/PollingProgressScenario.vue`
- `src/playground/scenarios/polling-progress-model.ts`
- `tests/playground/scenarios/polling-progress.spec.ts`
- `docs/implementation/85-milestone-8f-polling-progress-playground-note.md`

## Files updated

- `src/playground/App.vue`
- `tests/playground/App.spec.ts`
- `README.md`
- `docs/README.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/78-milestone-8-refresh-polling-plan.md`
- `docs/testing/01-test-strategy.md`

## Automated coverage prepared

Vue Testing Library coverage verifies deterministic progress, non-overlap metrics, completion, business failure, timeout, retry delay, pause/resume, unmount cleanup, and reset. The playground shell test now mounts the Polling Progress tab as part of tab traversal.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of the deterministic scenario model passed.
- Existing M8B through M8E compiled smoke scenarios remained valid.
- Documentation links and changed-file ZIP integrity were checked.

The exact repository command suite subsequently passed against the combined Milestone 8 checkout.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Manual validation should also confirm the Polling Progress controls, keyboard focus, status text, tab switching cleanup, and zero outstanding timers after reset.

## Next task

After offline M8F validation, proceed with M8G documentation reconciliation, migration review, full validation, and release-readiness assessment.
