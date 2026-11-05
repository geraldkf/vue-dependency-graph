# Recipe 05 — Selective event invalidation

**Status:** pre-1.0 pattern  
**Related:** [ADR-006 Domain events](../decisions/ADR-006-domain-events.md), [Events, refresh policies, and polling](../architecture/04-events-refresh-and-polling.md)

## Failure mode

A high-frequency stream (alerts, inventory ticks, presence) is wired with a broad `whenEvent` that invalidates large nodes on every message. The scheduler coalesces flushes, but you still pay for repeated loads, derived recomputation, and UI churn.

Typical symptoms:

- Every inventory tick reloads the entire product catalogue node.
- Alert flood causes the whole ops dashboard graph to thrash.
- Event handler that also mutates local state _and_ invalidates the same fact twice.

## Rule

Publish typed domain events. Invalidate with **predicates** that match only the nodes and rows that care. Prefer narrow nodes over one giant node that everything depends on.

## Minimal correct shape

```ts
const SelectedDate = defineContextNode<string>({
  key: "selectedDate",
  initialValue: todayIso(),
});

const InventoryChanged = defineEvent<{
  sku: string;
  warehouseId: string;
  quantity: number;
}>("inventory-changed");

const WarehouseId = defineContextNode<string | null>({
  key: "warehouseId",
  initialValue: null,
});

const WarehouseStock = defineDataNode({
  key: "warehouseStock",
  dependencies: [WarehouseId],
  initialValue: [] as StockRow[],
  load: ({ get, signal }) => {
    const id = get(WarehouseId);
    if (id == null) return [];
    return api.stock.list(id, { signal });
  },
  invalidatedBy: [
    whenEvent(
      InventoryChanged,
      [WarehouseId],
      ({ payload, get }) => payload.warehouseId === get(WarehouseId),
    ),
  ],
});
```

Only events for the current warehouse schedule work for `WarehouseStock`.

## Publishing

```ts
// From a push adapter or after a local mutation reconcile
runtime.publish(InventoryChanged, {
  sku: "ABC",
  warehouseId: "w-1",
  quantity: 12,
});

// Or inside a transaction with context changes
await runtime.transaction(async (tx) => {
  tx.setContext(WarehouseId, nextId);
  tx.publish(InventoryChanged, payload);
});
```

## Prefer narrow nodes

| Approach                                                 | When it hurts                          |
| -------------------------------------------------------- | -------------------------------------- |
| One `Catalogue` node invalidated by any SKU event        | High-frequency ticks reload everything |
| Per-warehouse or per-SKU nodes with selective predicates | More declarations, far less work       |

Start with the coarsest node that product needs; split when event volume makes cost visible (diagnostics help).

## Common wrong shapes

```ts
// Wrong: invalidate regardless of current context
invalidatedBy: [whenEvent(InventoryChanged, [], () => true)],

// Wrong: apply the same delta in reconcile and again in a global event listener
// without a clear single source of truth

// Wrong: using events to replace ordinary dependency edges between stores
// (ADR-006: events are for cross-domain facts, not a general bus for local state)
```

## Interaction with optimistic mutations

If a mutation already reconciled a node to server truth, a following event for the same fact should either:

- be a no-op because the predicate does not fire, or
- trigger a cheap refresh that converges to the same value.

Avoid designing events that always force a full reload after every local success unless the server may have additional side effects you must see.

## Checklist

- [ ] Event payloads carry enough identifiers for predicates (ids, dates, tenants).
- [ ] `whenEvent` predicates read only declared dependency contexts via `get`.
- [ ] High-frequency streams invalidate the smallest practical node.
- [ ] Diagnostics show event → invalidation → execution attribution when debugging storms.
- [ ] Tenancy fields in payloads are checked when relevant ([Recipe 03](./03-tenancy-auth-context.md)).

## What this recipe does not own

- Transport (WebSocket, SSE, polling bridge) — adapter publishes into the runtime.
- Server fan-out and filtering; client predicates are a second line of defence.
- Ordering guarantees across multiple event sources (document your adapter’s assumptions).
