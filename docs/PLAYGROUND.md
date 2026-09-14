# Playground Harness

## Goal

Build a dedicated Vue application to validate framework behaviour.

## Features

### Graph Explorer

Show:

- nodes
- dependencies
- status

### Event Console

Publish events.

### Transaction Console

Execute batched updates.

### API Simulator

Configure:

- delay
- failure rates
- polling completion

### Metrics Dashboard

View:

- execution count
- cache statistics

### Snapshot Export

Download current graph state.


## Implemented scenarios

### Concurrency Limit

The Concurrency Limit scenario creates four independent data nodes in a dedicated runtime. Select a maximum of `1`, `2`, or unlimited, then use **Run all** to submit every load together.

The scenario displays:

- Active loader count
- Maximum observed concurrency
- FIFO loader start order
- Per-loader state: `idle`, `waiting`, `running`, or `completed`

Use **Complete next** to release the earliest running loader and observe the next queued loader start. **Complete all** drains currently running work. **Reset** first drains running and queued work, then creates a clean runtime using the selected construction-time limit.

Manual validation:

1. With limit `1`, only one loader runs and each completion admits the next loader.
2. With limit `2`, two loaders run and each completion admits one queued loader.
3. With unlimited selected, all four loaders run before any completes.
4. Reset clears counts, start order, and loader states.
5. Switching tabs while work is active does not leave suspended scenario work behind.

### Atomic Transaction

The Atomic Transaction scenario uses two related context values and one derived result in a dedicated runtime.

Use **Start transaction** to stage the first context update. The Transaction progress section shows the local draft `2 + 10` and preview `12`, while Committed runtime state remains `1 + 10 = 11`.

Use **Stage second value** to advance the draft to `2 + 20` and preview `22`. Committed runtime state and committed observer snapshots remain unchanged.

Use **Commit transaction** to release the final gate. Both context values then become committed together, the derived result becomes `22`, and the local transaction draft is cleared.

Alternatively, use **Rollback with error** after staging the second value. The scenario throws a local transaction error, clears the draft, displays the rollback outcome and error, and leaves committed runtime state at `1 + 10 = 11` with no committed observer snapshot. This demonstrates local graph rollback, not rollback of remote API work.

Manual validation:

1. Confirm committed values are `1 + 10`, committed result is `11`, and in-progress values are `none`.
2. Select **Start transaction**.
3. Confirm phase is `first-staged`, committed state remains `1 + 10 = 11`, and transaction progress shows `2 + 10 = 12`.
4. Confirm committed observer snapshots remain empty.
5. Select **Stage second value**.
6. Confirm phase is `second-staged`, committed state remains `1 + 10 = 11`, and transaction progress shows `2 + 20 = 22`.
7. Select **Commit transaction**.
8. Confirm phase is `committed`, committed state is `2 + 20 = 22`, and in-progress values are `none`.
9. Confirm observer history contains `2 + 20` but never `2 + 10` or `1 + 20`.
10. Select **Reset** and confirm the scenario returns atomically to `1 + 10`, shows result `11`, and clears progress, snapshot history, and the displayed derivation count.
11. Start another transaction, optionally stage the second value, switch to a different scenario before commit, and confirm no warning is shown.
12. Return to Atomic Transaction and confirm a clean dedicated scenario is shown with no suspended transaction.

Rollback path:

1. Reset the scenario.
2. Select **Start transaction**, then **Stage second value**.
3. Confirm transaction progress shows `2 + 20 = 22` while committed runtime state remains `1 + 10 = 11`.
4. Select **Rollback with error**.
5. Confirm phase is `rolled-back`, outcome is `rolled back`, and the error `Playground transaction rollback` is displayed.
6. Confirm committed runtime state remains `1 + 10 = 11`.
7. Confirm in-progress values are `none` and committed observer snapshots remain empty.
8. Select **Reset** and confirm outcome returns to `none` and the error is cleared.


## Typed Events

The **Typed Events** scenario demonstrates cross-domain event invalidation. An appointments-domain publisher emits `appointment.booked`; a capability-status node conditionally matches the payload against its declared job-seeker context dependency.

The publisher does not import the capability node, loader, or a compliance store. The capability node does not import an appointments store or publishing service.

Manual validation:

1. Confirm job seeker `101` and initial request count `1`.
2. Publish a matching event and confirm one capability reload.
3. Publish a non-matching event and confirm no additional request.
4. Start an event transaction and confirm request count remains unchanged while phase is `staged`.
5. Commit and confirm exactly one reload and phase `committed`.
6. Reset and confirm request count `1`, phase `idle`, outcome `ready`, and empty history.
7. Start another transaction, roll it back, and confirm no reload.
8. Start a transaction, switch tabs, return, and confirm no suspended transaction or warning.
