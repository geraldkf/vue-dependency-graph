# Recipe 02 — Optimistic mutation, reconcile, and events

**Status:** pre-1.0 pattern  
**Related:** [ADR-013 Mutation framework](../decisions/ADR-013-mutation-framework.md), [ADR-006 Domain events](../decisions/ADR-006-domain-events.md), [Mutations, failures, and cache](../architecture/05-mutations-failures-and-cache.md)

## Failure mode

Optimistic UI updates stick after a failed mutation, get double-applied when a domain event arrives, or treat cancellation/abort as a business error. Concurrent users can also leave the client graph diverged from the server.

Typical symptoms:

- Slot stays "held by me" after the hold API rejected the request.
- Cart quantity jumps twice: once from the optimistic path, once from an `InventoryChanged` event.
- Aborted navigation surfaces as a red error toast.

## Rule

Use `defineMutation` for the write path itself (`key` + `execute`). Put temporary UI state and success reconciliation in `optimistic`, `onSuccess` and `classifyFailure` — on `runtime.mutate`'s options when call sites differ (shown below), or on `defineMutation` as defaults when the mutation always behaves the same way. A field passed to `runtime.mutate` replaces the definition's default for that call. Keep **server conflict policy** outside the library.

The library coordinates client graph state. It does not implement distributed locking or last-write-wins for you.

## Minimal correct shape

```ts
const SelectedDate = defineContextNode<string>({
  key: "selectedDate",
  initialValue: todayIso(),
});

const SlotTaken = defineEvent<{ date: string; slotId: string }>("slot-taken");
const HoldExpired = defineEvent<{ date: string; slotId: string }>("hold-expired");

const Availability = defineDataNode({
  key: "availability",
  dependencies: [SelectedDate],
  initialValue: [] as Slot[],
  load: ({ get, signal }) => api.availability.list(get(SelectedDate), { signal }),
  invalidatedBy: [
    whenEvent(SlotTaken, [SelectedDate], ({ payload, get }) => payload.date === get(SelectedDate)),
    whenEvent(
      HoldExpired,
      [SelectedDate],
      ({ payload, get }) => payload.date === get(SelectedDate),
    ),
  ],
});

// This definition is execute-only: nothing optimistic lives here, which is
// what lets the same mutation be reused from different call sites with
// different optimistic behaviour. (If every call site behaved the same, the
// optimistic/onSuccess/classifyFailure below could be defaults on this
// definition instead.)
const PlaceHold = defineMutation({
  key: "placeHold",
  execute: async ({ input, signal }: { input: { slotId: string }; signal: AbortSignal }) =>
    api.holds.create(input.slotId, { signal }),
});
```

Usage — the optimistic update, success reconciliation, and failure classification are all supplied per call:

```ts
import {
  GraphMutationError,
  GraphMutationOutcomeUnknownError,
  GraphMutationRollbackConflictError,
} from "vue-dependency-graph/core";

try {
  await runtime.mutate(
    PlaceHold,
    { slotId },
    {
      // Mark the slot held locally so the UI feels instant.
      optimistic: (effects, input) => {
        effects.update(Availability, (current) =>
          current.map((slot) =>
            slot.id === input.slotId ? { ...slot, status: "held" as const } : slot,
          ),
        );
      },
      // Once confirmed, refetch the authoritative list rather than trust
      // the optimistic guess.
      onSuccess: (effects) => {
        effects.invalidate([Availability]);
      },
      // A confirmed "already taken" rejection is safe to roll back; anything
      // ambiguous (dropped connection, timeout) has an unknown outcome and
      // must not be rolled back automatically.
      classifyFailure: (error) =>
        error instanceof Error && error.message === "SLOT_TAKEN" ? "rejected" : "unknown",
    },
  );
} catch (error) {
  if (error instanceof GraphMutationRollbackConflictError) {
    // A SlotTaken/HoldExpired event already invalidated Availability
    // before the rejection came back — rolling back would discard that
    // newer state, so it wasn't. Nothing to do here; let the reload settle.
  } else if (error instanceof GraphMutationOutcomeUnknownError) {
    // Connection dropped mid-request — genuinely unknown outcome. Don't
    // retry blindly; tell the user confirmation is pending.
  } else if (error instanceof GraphMutationError) {
    // Any other mutation failure (including a confirmed SLOT_TAKEN
    // rejection, already rolled back) — show generic messaging.
  } else {
    throw error;
  }
}
```

## Event path after success

Other clients (or this client's push channel) may publish `SlotTaken`. Prefer **selective** invalidation (see [Recipe 05](./05-selective-event-invalidation.md)) so the availability node reloads only when the event matches the current date.

Do not apply the same delta both in `onSuccess` and again from a naive event handler unless the event is the sole source of truth by design.

## Common wrong shapes

```ts
// Smell, not an error: defaults on a definition whose call sites mostly need
// something different. A call that passes its own `optimistic` replaces the
// default (the two never both run), so it works — but if most call sites
// override a default, keep the definition execute-only and pass effects per
// call instead.

// Wrong: classifying every failure as "rejected" — a dropped connection then
// rolls back a hold that may have actually succeeded
await runtime.mutate(
  PlaceHold,
  { slotId },
  {
    optimistic: (effects, input) => {
      /* patch */
    },
    classifyFailure: () => "rejected", // only return "rejected" with real evidence
  },
);
// Omitting classifyFailure is the safe default: every failure is treated as
// "unknown", the optimistic value stays visible as unconfirmed, and the call
// rejects with GraphMutationOutcomeUnknownError.

// Wrong: treating abort as business error in UI
// Aborted attempts should not become user-facing domain failures.
// See ADR-018 (abort ends the attempt).

// Wrong: mutating server state inside a graph transaction callback
// and expecting the transaction to roll the server back.
// Graph transactions are local only (ADR-005) — and a runtime.mutate(...)
// call inside a transaction body isn't part of it either.
```

## Conflict policy (application-owned)

Choose explicitly and document in the product:

| Strategy        | Client behaviour                                          |
| --------------- | --------------------------------------------------------- |
| Version check   | Mutation payload carries version; 409 → rollback + reload |
| Last write wins | Accept server body; replace local node values             |
| Force refresh   | Rollback optimistic nodes and invalidate related queries  |
| User choice     | Surface conflict UI; apply one of the above on decision   |

The mutation framework gives you the hooks (`optimistic`, `execute`, `onSuccess`, `classifyFailure`, and the `GraphMutationError` family). The policy table lives in application code.

## Concurrent tabs / users

- Separate runtimes do not share transaction or mutation sessions.
- Server remains the authority for double-booking and concurrent edits.
- Use events so each runtime can invalidate its own nodes when the truth changes.

## Checklist

- [ ] Optimistic patch is limited to nodes the user is looking at.
- [ ] `classifyFailure` is supplied whenever a mutation has an optimistic update — don't let ambiguous failures default to "rejected".
- [ ] Failure path rolls back optimistic values (or, per `GraphMutationRollbackConflictError`, lets newer state stand) rather than always trusting the optimistic guess.
- [ ] Abort / cancellation is not shown as a domain error.
- [ ] Domain events that represent the same fact are selective and do not double-apply blindly.
- [ ] Server conflict strategy is written down for the feature.
