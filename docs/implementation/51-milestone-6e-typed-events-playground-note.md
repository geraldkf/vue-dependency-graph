# Milestone 6E: Typed Events Playground Scenario

## Status

Implementation prepared. Automated and manual playground validation pending.

## Objective

Demonstrate the Milestone 6 exit criterion in the executable playground:

> Appointment events invalidate capability status without either store importing the other.

## Cross-domain structure

The scenario separates the example into two domain-facing modules:

```text
appointments-domain.ts
  owns AppointmentBooked
  owns publishAppointmentBooked(...)

TypedEventsScenario.vue
  integration shell
  invokes the appointments publisher
  observes the graph-owned compliance node

typed-events-nodes.ts
  owns JobSeekerId context
  owns CapabilityInterviewStatus
  declares conditional event invalidation
```

The appointments publisher imports only the shared runtime contract and its event handle. It does not import the capability node, its loader, or a compliance store. The capability node imports the event contract but does not import an appointments store or publishing implementation.

## Scenario behaviour

The **Typed Events** tab exposes:

- the committed job seeker identifier;
- capability status data;
- node status and freshness;
- deterministic request count;
- editable event job seeker input;
- matching and non-matching publication controls;
- staged transaction commit and rollback controls;
- outcome text;
- explanatory publication history;
- deterministic reset.

### Matching publication

Publishing an appointment for the current job seeker invalidates the capability-status node and reloads it through the existing subscription scheduler. Request count and returned status text advance deterministically.

### Non-matching publication

Publishing for another job seeker causes no invalidation or reload. Request count and capability data stay unchanged.

### Transaction commit

Starting an event transaction stages one matching publication and leaves committed capability state unchanged. Commit applies event invalidation and reloads the subscribed capability node.

### Transaction rollback

Rollback throws a local demonstration error. The transaction discards the staged publication, leaves capability state unchanged, and reports the rollback outcome.

### Reset and unmount

Reset restores job seeker `101`, resets the deterministic loader count, refreshes capability status to request `1`, clears history, and returns the scenario to `idle`.

Unmount resolves an open transaction through the rollback path. Post-unmount handlers do not update component state.

## Automated coverage

`tests/playground/scenarios/typed-events.spec.ts` covers:

- matching event reload;
- non-matching event no-op;
- staged event invisibility before commit;
- committed transaction reload;
- rollback without reload;
- deterministic reset;
- unmount cleanup.

`tests/playground/App.spec.ts` includes the new scenario in shell tab navigation coverage.

## Files changed

- `src/playground/App.vue`
- `src/playground/playground-graph.ts`
- `src/playground/scenarios/appointments-domain.ts`
- `src/playground/scenarios/typed-events-nodes.ts`
- `src/playground/scenarios/TypedEventsScenario.vue`
- `tests/playground/App.spec.ts`
- `tests/playground/scenarios/typed-events.spec.ts`
- `docs/PLAYGROUND.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/02-playground.md`
- `docs/implementation/46-milestone-6-typed-events-plan.md`
- `docs/implementation/51-milestone-6e-typed-events-playground-note.md`
- `docs/README.md`

## Manual validation

1. Open **Typed Events**.
2. Confirm current job seeker is `101` and initial capability load reaches request `1`.
3. Select **Publish matching event**.
4. Confirm request count becomes `2`, capability text reports request `2`, and the node returns to `success / fresh`.
5. Select **Publish non-matching event**.
6. Confirm request count remains `2` and the outcome reports that the event was ignored.
7. Select **Start event transaction**.
8. Confirm transaction phase is `staged`, outcome says committed state is unchanged, and request count does not change.
9. Select **Commit event transaction**.
10. Confirm phase becomes `committed` and request count advances once.
11. Select **Reset** and confirm request count returns deterministically to `1`, phase returns to `idle`, outcome returns to `ready`, and history is empty.
12. Select **Start event transaction**, then **Rollback event transaction**.
13. Confirm phase becomes `rolled-back`, the rollback message appears, and request count remains unchanged.
14. Start another event transaction and switch to another tab.
15. Return to **Typed Events** and confirm a clean scenario with no suspended transaction or warning.

## Validation contract

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

M6E remains validation pending until automated commands and the manual checklist pass.

## Next task

After successful M6E validation, proceed with **M6F: Documentation and final Milestone 6 validation**.
