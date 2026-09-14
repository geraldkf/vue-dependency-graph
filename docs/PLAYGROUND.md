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

Use **Start transaction** to stage the first context update and pause at an awaited gap. While the transaction is open, the displayed committed values, combined result, derivation count, and observer snapshot history remain unchanged.

Use **Complete transaction** to stage the second value and commit the outer transaction. The scenario then displays the final pair, recomputes the combined result once, and records only the coherent committed observer snapshot.

Manual validation:

1. Confirm the initial committed values are `1 + 10` and the combined result is `11`.
2. Select **Start transaction**.
3. Confirm the transaction state is `open` and no `2 + 10` snapshot appears.
4. Select **Complete transaction**.
5. Confirm the committed values are `2 + 20` and the combined result is `22`.
6. Confirm observer history contains `2 + 20` but never `2 + 10` or `1 + 20`.
7. Confirm the derivation count advances only for the committed result.
8. Select **Reset** and confirm the scenario returns to its initial values with a cleared snapshot history.
