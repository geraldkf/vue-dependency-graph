# TOI-8C Event Isolation Playground Note

## Status

Prepared. TOI-8D coverage reconciliation added; offline validation pending.

## Implemented

- Extended the existing Typed Events scenario instead of adding another playground tab.
- Added a separate typed event and subscribed data target for unrelated runtime publication.
- Added a **Publish unrelated event now** action available while the appointment event transaction is staged.
- Displayed the unrelated target result, request count, and publication outcome.
- Demonstrated that plain `runtime.publish(...)` invalidates and reloads its subscribed target before the staged transaction closes.
- Demonstrated that rolling back the staged appointment event does not discard the unrelated event effect.
- Preserved the staged appointment event's original commit and rollback behaviour.
- Reset now restores both capability and unrelated event state deterministically.
- Added behaviour-focused playground coverage for immediate publication, independent reload, staged-event rollback, and preservation.

## Demonstrated outcome

1. Start the appointment event transaction.
2. Confirm the appointment event is staged and capability requests remain unchanged.
3. Select **Publish unrelated event now**.
4. Confirm the unrelated request count advances and its result reloads while transaction phase remains `staged`.
5. Roll back the appointment event transaction.
6. Confirm capability requests remain unchanged.
7. Confirm the unrelated event result and request count remain committed.

## Validation commands

```text
pnpm typecheck --pretty false
pnpm test:run tests/playground/scenarios/typed-events.spec.ts --reporter verbose --no-color
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```
