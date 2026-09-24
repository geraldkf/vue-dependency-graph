# Recipe 08 — Multi-node panels with `useNodes` / `isSuccess`

**Status:** research-phase / migration convention  
**Related:** [UI, Pinia, and the dependency graph](../guides/01-ui-and-pinia-graph.md) §6.3–§7, [Public API — Vue composables](../api/01-public-api.md)

## Failure mode

A page with several panels waits on `runtime.whenSettled()`, blanks the whole view on any loading flag, or invents a custom `isReady` that drifts from library semantics. One slow detail panel blocks the list; other features’ scheduler work delays “page ready.”

## Rule

- **Single node:** `useNode` → `hasSuccessfulValue` for usable data.
- **Several nodes required together:** `useNodes` → **`isSuccess`** (every node has a successful value).
- **Each panel** on a page uses **its own** node list and its own blocker region.
- Always pass the Pinia store **`runtime`** explicitly (department default).

## Store + panel (canonical)

```ts
// stores/orders-graph.ts — see Recipe 07 / user guide Pinia section
const { runtime } = useOrdersGraphStore();
```

```ts
import { computed } from "vue";
import { useNodes } from "vue-dependency-graph/vue";
import { Orders, OrderMetrics } from "../graph/orders-nodes";
import { useOrdersGraphStore } from "@/stores/orders-graph";

const { runtime } = useOrdersGraphStore();

const { results, isSuccess, isLoading, isError, errors } = useNodes(
  [Orders, OrderMetrics],
  { runtime },
);

const showBlocker = computed(() => isLoading.value && !isSuccess.value);
const showHardError = computed(() => isError.value && !isSuccess.value);
const showSoftError = computed(() => isError.value && isSuccess.value);
```

| UI | Condition |
|----|-----------|
| Skeleton | `isLoading && !isSuccess` |
| Body | `isSuccess` |
| Soft banner | `isError && isSuccess` |
| Hard error | `isError && !isSuccess` |

## Multi-panel page

```text
OrderFilters (writer → store actions)
OrderListPanel  → useNodes([Orders, OrderMetrics], { runtime })
OrderDetailPanel → useNode(OrderDetail, { runtime })
```

List and detail skeletons are independent. Do **not**:

```ts
await runtime.whenSettled(); // wrong tool for panel visibility
```

## Naming

- Prefer **`isSuccess`** in code (matches public API).
- Informal “panel ready” in product copy **means** `isSuccess` unless the feature documents a stricter rule (e.g. must be fresh).
- Do not add a duplicate `isReady` API.

## Checklist

- [ ] `const { runtime } = useFeatureGraphStore()` then `{ runtime }` on composables.
- [ ] Multi-node panels use `useNodes` aggregates.
- [ ] No page-level `whenSettled()` for show/hide.
- [ ] Blockers are region-scoped per panel.
