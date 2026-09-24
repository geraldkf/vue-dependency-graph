# Recipe 02 — Optimistic mutation, reconcile, and events

**Status:** research-phase pattern  
**Related:** [ADR-013 Mutation framework](../decisions/ADR-013-mutation-framework.md), [ADR-006 Domain events](../decisions/ADR-006-domain-events.md), [Mutations, failures, and cache](../architecture/05-mutations-failures-and-cache.md)

## Failure mode

Optimistic UI updates stick after a failed mutation, get double-applied when a domain event arrives, or treat cancellation/abort as a business error. Concurrent users can also leave the client graph diverged from the server.

Typical symptoms:

- Slot stays “held by me” after the hold API rejected the request.
- Cart quantity jumps twice: once from the optimistic path, once from an `InventoryChanged` event.
- Aborted navigation surfaces as a red error toast.

## Rule

Use `defineMutation` for the write path. Put temporary UI state in the optimistic update, put authoritative correction in reconcile (or in event-driven invalidation), and keep **server conflict policy** outside the library.

The library coordinates client graph state. It does not implement distributed locking or last-write-wins for you.

## Minimal correct shape

```ts
const SelectedDate = defineContextNode<string>({
  key: "selectedDate",
  initialValue: todayIso(),
});

const Availability = defineDataNode({
  key: "availability",
  dependencies: [SelectedDate],
  initialValue: [] as Slot[],
  load: ({ get, signal }) => api.availability.list(get(SelectedDate), { signal }),
  invalidatedBy: [
    whenEvent(SlotTaken, [SelectedDate], ({ payload, get }) =>
      payload.date === get(SelectedDate),
    ),
    whenEvent(HoldExpired, [SelectedDate], ({ payload, get }) =>
      payload.date === get(SelectedDate),
    ),
  ],
});

const SlotTaken = defineEvent<{ date: string; slotId: string }>("slot-taken");
const HoldExpired = defineEvent<{ date: string; slotId: string }>("hold-expired");

const PlaceHold = defineMutation({
  key: "placeHold",
  // Optimistic: mark the slot held locally so the UI feels instant.
  optimistic: ({ input, get }) => {
    const slots = get(Availability);
    return {
      [Availability.key]: slots.map((s) =>
        s.id === input.slotId ? { ...s, status: "held" as const } : s,
      ),
    };
  },
  execute: async ({ input, signal }) => {
    return api.holds.create(input.slotId, { signal });
  },
  // Reconcile: replace optimistic view with server truth, or refresh.
  reconcile: ({ result, error, rollback }) => {
    if (error) {
      rollback();
      return;
    }
    // Optional: patch from result, or let a follow-up invalidation reload.
  },
});
```

Usage:

```ts
try {
  await runtime.mutate(PlaceHold, { slotId });
} catch (error) {
  // Business failure after rollback — show product messaging.
}
```

## Event path after success

Other clients (or this client’s push channel) may publish `SlotTaken`. Prefer **selective** invalidation (see [Recipe 05](./05-selective-event-invalidation.md)) so the availability node reloads only when the event matches the current date.

Do not apply the same delta both in `reconcile` and again from a naive event handler unless the event is the sole source of truth by design.

## Common wrong shapes

```ts
// Wrong: optimistic update with no rollback on failure
optimistic: ({ input, get }) => { /* patch */ },
execute: async ({ input }) => api.holds.create(input.slotId),
// missing reconcile / error path → stuck "held"

// Wrong: treating abort as business error in UI
// Aborted attempts should not become user-facing domain failures.
// See ADR-018 (abort ends the attempt).

// Wrong: mutating server state inside a graph transaction callback
// and expecting the transaction to roll the server back.
// Graph transactions are local only (ADR-005).
```

## Conflict policy (application-owned)

Choose explicitly and document in the product:

| Strategy | Client behaviour |
|----------|------------------|
| Version check | Mutation payload carries version; 409 → rollback + reload |
| Last write wins | Accept server body; replace local node values |
| Force refresh | Rollback optimistic nodes and invalidate related queries |
| User choice | Surface conflict UI; apply one of the above on decision |

The mutation framework gives you hooks (`optimistic`, `execute`, `reconcile`, errors). The policy table lives in application code.

## Concurrent tabs / users

- Separate runtimes do not share transaction or mutation sessions.
- Server remains the authority for double-booking and concurrent edits.
- Use events so each runtime can invalidate its own nodes when the truth changes.

## Checklist

- [ ] Optimistic patch is limited to nodes the user is looking at.
- [ ] Failure path rolls back optimistic values (or replaces them with server truth).
- [ ] Abort / cancellation is not shown as a domain error.
- [ ] Domain events that represent the same fact are selective and do not double-apply blindly.
- [ ] Server conflict strategy is written down for the feature.
