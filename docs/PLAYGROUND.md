# Playground Harness

## Goal

Build a dedicated Vue application to validate framework behaviour.

## Features

An early wishlist for a single unified explorer UI, written before the playground existed. It didn't happen in that shape: the playground grew into one dedicated scenario page per behaviour instead (see "Implemented scenarios" below), which turned out to suit "demonstrate and manually validate one specific mechanism at a time" better than a single do-everything panel would have.

Graph exploration, metrics, and snapshot export are provided by the reusable devtools panel in `src/devtools`, which can be embedded in any consuming app. The Devtools scenario demonstrates it against this playground's own runtimes.

## Implemented scenarios

### Runtime Ownership

This scenario creates a dedicated runtime for each mount. **Start request** or **Start mutation** begins manually gated work that deliberately ignores its abort signal. **End owner lifetime** calls `shutdown()`: the UI reports a handled `GraphRuntimeShutdownError`, an aborted signal and zero demand. Delivering the late response leaves the committed value unchanged and does not run mutation success effects.

Switch tabs during a pending mutation, then return. The old owner shuts down and observes its late remote completion; the new owner starts with value `1` and can complete its own mutation normally. The production browser check exercises these paths and verifies there are no uncaught page errors.

The Polling Progress scenario also supports **Start new job** after completion or failure. It retains the mounted consumer, changes the operation identity and explicitly refreshes the node; the new generation starts a fresh polling cycle. It does not replace the runtime to hide terminal-session behavior.

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

## Transaction ownership isolation

The Atomic Transaction scenario now demonstrates an unrelated runtime context update while a transaction is paused. The plain `runtime.setContext(...)` update becomes visible immediately, reloads its subscribed dependent before the transaction closes, and remains committed when the staged transaction rolls back. This is intentionally separate from the same-context conflict demonstration planned for TOI-8B.

The Atomic Transaction scenario also demonstrates same-context optimistic conflict detection. A transaction stages the first context, a plain runtime write commits `999` to that same context, and transaction commit rejects with `GraphTransactionConflictError`. The UI displays the conflicting context key and confirms the immediate value remains committed while the other staged value is not applied.

## Typed event ownership isolation

The Typed Events scenario now includes an unrelated event target and a **Publish unrelated event now** action while the appointment event transaction is staged. The plain `runtime.publish(...)` publication reloads its target before the transaction closes and remains committed when the staged appointment event rolls back. The appointment event remains invisible and its capability request count does not advance.

## Transaction ownership demonstration flow

### Unrelated context update

1. Open **Atomic Transaction** and start the transaction.
2. While phase is `first-staged`, select **Apply unrelated runtime update**.
3. Confirm the unrelated context and subscribed dependent become `999` before transaction closure.
4. Stage the second transaction value and roll back.
5. Confirm transaction-owned values remain `1 + 10` and unrelated values remain `999`.

### Same-context conflict

1. Start the transaction.
2. Select **Apply conflicting runtime update** while the first context is staged.
3. Confirm committed values become `999 + 10`.
4. Stage the second value and commit.
5. Confirm phase `conflicted`, outcome `conflict rejected`, and conflict key `atomic-transaction-first`.
6. Confirm no `2 + 20` or `999 + 20` partial staged state appears.

### Unrelated event publication

1. Open **Typed Events** and start the event transaction.
2. Select **Publish unrelated event now** while the appointment event is staged.
3. Confirm the unrelated target reloads before transaction closure.
4. Roll back the appointment event transaction.
5. Confirm the capability request count is unchanged and the unrelated event result remains committed.

### Polling Progress

The Polling Progress scenario uses an isolated runtime with a deterministic virtual clock. It demonstrates the real poll-until policy path without wall-clock waits or random outcomes.

Controls:

- **Mount consumer** starts subscription-owned loading.
- **Advance one poll** advances the virtual clock by one interval.
- **Complete** returns a completed response and stops polling.
- **Fail** returns a business-failure response while retaining progress.
- **Trigger timeout** advances active time to the polling timeout.
- **Fail next request** demonstrates the deterministic 500 ms retry delay.
- **Pause** clears the pending timer and freezes timeout budget.
- **Resume** restores one remaining delay without replaying missed ticks.
- **Unmount consumer** releases subscription ownership and timers.
- **Reset** creates a clean scenario with zero requests and zero outstanding timers.

The diagnostics show operation ID, progress, business state, node status, freshness, error type, request counts, maximum concurrency, retry attempt, scheduled delay, timer count, and lifecycle state.

Manual validation passed for progress, completion, business failure, timeout, retry, pause/resume, unmount, reset, and tab-switch cleanup.

### Query Groups

The **Query Groups** scenario demonstrates one immutable aliased query definition reused for prefetch, component subscription, aggregate state, and refresh.

Manual validation:

- Open **Query Groups** and confirm both request counts are 0 and direct subscriptions are 0.
- Select **Prefetch page** and confirm both request counts become 1 while direct subscriptions remain 0.
- Select **Mount consumer** and confirm the prefetched appointment, capability status, and derived summary appear without another request.
- Confirm aggregate state reports loading false, error false, and success true.
- Select **Refresh page** and confirm both request counts become 2 and all aliased results update together.
- Select **Unmount consumer** and confirm direct subscriptions return to 0.
- Mount the consumer again, switch to another scenario tab, and confirm the query subscriptions are released without warnings.

### Devtools

The **Devtools** scenario mounts `GraphDevtoolsPanel` (`src/devtools`) against a dedicated runtime with a context node, a data node carrying both an event-invalidation rule and a refresh policy, a derived node, and a mutation, providing enough variety to exercise every tab.

Controls:

- **Change user** advances the context, invalidating the data node and its derived descendant.
- **Book appointment** runs a mutation whose success effect publishes an event, which invalidates the appointments node through its event-invalidation rule (not through the mutation's own effects directly) - a deliberate way to demonstrate the event lane in the Graph tab.
- **Fail next load** causes the _next_ load of the appointments node to fail, for exercising the error state and the Timeline's failure highlighting.

Manual validation:

1. Open **Devtools** and confirm the Graph tab shows all four real nodes positioned in dependency-depth columns, plus one dashed event node in its own lane to the left with an edge into the appointments node.
2. Click a node in the graph and confirm the panel switches to the Node tab showing that node's status, dependencies, descendants, subscriber count, and (for the appointments node) its refresh policy or invalidating event.
3. Select **Change user** and confirm the graph's appointments and appointment-count nodes transition through loading to success with a new value, and a corresponding entry appears in the Timeline.
4. Select **Fail next load**, then **Change user**, and confirm the failed load appears highlighted in the Timeline and the Node tab shows the error while still enumerating dependencies/descendants normally.
5. Select **Book appointment** and confirm an `event.published` and a `node.invalidated` entry appear in the Timeline attributing the appointments reload to the event, not to a direct mutation effect.
6. Open the Metrics tab and confirm the operation, execution, and mutation counters are nonzero and update as further actions run.
7. Select **Export snapshot**, then **Load snapshot** and choose the file just downloaded: confirm the panel switches into "viewing offline snapshot" mode showing the same graph, node detail, timeline, and metrics as when it was exported, entirely without the live runtime.
8. Select **Return to live** and confirm the panel resumes reflecting the live runtime, including any activity that happened while offline mode was open.
9. Attempt to load an unrelated or corrupted file and confirm a clear inline error appears without leaving the panel stuck in a broken state.
