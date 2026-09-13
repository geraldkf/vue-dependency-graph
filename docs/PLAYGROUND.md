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
