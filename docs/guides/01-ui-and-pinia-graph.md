# UI, Pinia, and the dependency graph

**Status:** working convention for the migration trial (not frozen API law)  
**Audience:** feature developers, reviewers, AI agents generating feature code  
**Department default:** Pinia owns the `GraphRuntime`; components pass an explicit `runtime` into Vue composables.

**Related documentation**

- [Vue and Pinia integration (architecture)](../architecture/07-vue-and-pinia-integration.md)
- [User guide](./00-user-guide.md)
- [Public API](../api/01-public-api.md)
- Recipes: [01 cascade](../recipes/01-atomic-cascade.md), [02 optimistic mutation](../recipes/02-optimistic-mutation-reconcile.md), [03 tenancy](../recipes/03-tenancy-auth-context.md), [04 stale vs loading](../recipes/04-stale-vs-loading-rapid-change.md), [05 events](../recipes/05-selective-event-invalidation.md), [06 release](../recipes/06-release-when-unused.md), [07 Pinia ownership](../recipes/07-pinia-runtime-ownership.md)

**How to use this document during migration**

1. Map the chosen workflow to the ownership model in §2–3.
2. Fill a **context ownership table** for that workflow (§3.2).
3. Implement store + writers + consumers using the patterns in §4–8.
4. Apply the **status/freshness matrix** in §7 for every graph-backed view.
5. Run through the **migration checklist** in §14 before calling the trial done.
6. Record deviations and lessons in §15 so this guide can be updated.

---

## 1. Goals and non-goals

### 1.1 Goals

- One obvious place owns the runtime for a coherent workflow (a Pinia store).
- Clear split between **context writers** and **data consumers**.
- UI that uses `status`, `freshness`, `error`, and `hasSuccessfulValue` instead of inventing parallel loading flags.
- Safe lifecycle: component unmount releases subscriptions; store dispose disposes the runtime.
- Conventions an AI agent can follow without guessing plugin vs Pinia.

### 1.2 Non-goals

- Pinia does **not** become a second cache of graph node values.
- The graph does **not** replace Pinia for ordinary UI state (modals, column prefs, ephemeral drafts).
- The graph runtime does **not** enforce authorisation (server + capabilities; see Recipe 03).
- This guide does **not** require the Vue `createGraphRuntimePlugin` path as the department default (that path remains supported by the library; see architecture 07).

### 1.3 Source of truth

| Kind of state | Source of truth |
|---------------|-----------------|
| Node data, status, freshness, error, generations, subscriptions, scheduler | `GraphRuntime` |
| Which runtime instance exists for this workflow | Pinia store |
| Ephemeral UI (dialog open, local draft before submit) | Component or ordinary Pinia UI store |
| Session token / transport headers | Existing auth/HTTP layer |
| Row/field access on the server | API / policy engine |

---

## 2. Ownership model (department default)

```text
Pinia feature (or app) store
  └── markRaw(createGraphRuntime(graph))
        │
        │  runtime.transaction / setContext / mutate / publish
        │  useNode|useNodes|useQuery({ runtime })
        ▼
Vue components (writers and consumers)
```

### 2.1 Why Pinia owns the runtime here

- Matches existing department practice and the playground model.
- Avoids requiring a change to `App.vue` solely to install a graph plugin.
- Store lifetime is a natural match for “this workflow’s graph stays alive while the feature is in use.”
- Explicit `{ runtime }` makes ownership visible in every composable call (good for review and agents).

### 2.2 Resolution order (library behaviour)

Vue composables resolve runtime as:

1. `options.runtime` (explicit) — **preferred in this department**
2. Runtime from `createGraphRuntimePlugin` if installed
3. Missing-runtime error

Migration code should **always pass explicit `runtime`** so behaviour does not depend on whether a plugin was installed in a test or host app.

### 2.3 One runtime per coherent workflow

| Scope | Recommendation |
|-------|----------------|
| One product workflow (e.g. orders console) | One graph store, one runtime |
| Entire SPA with unrelated domains | Prefer separate stores/runtimes per domain, or one carefully namespaced graph — decide per migration; default to **one workflow = one runtime** for the trial |
| One runtime per table row / widget | **Forbidden** — explodes subscriptions and timers |

### 2.4 `markRaw`

The runtime is a closure-based service with its own observation mechanism. Vue must not deep-proxy it.

```ts
const runtime = markRaw(createGraphRuntime(graph, options));
```

### 2.5 No mirrored graph state in Pinia

**Do not** do this:

```ts
// WRONG — second source of truth
const orders = ref([]);
const ordersLoading = ref(false);
runtime.subscribe(Orders, (state) => {
  orders.value = state.data;
  ordersLoading.value = state.status === "loading";
});
```

**Do** this:

```ts
const { data, status, freshness, error, hasSuccessfulValue } = useNode(Orders, {
  runtime: store.runtime,
});
```

Mirrored state diverges on abort, refresh failure, optimistic rollback, and release. The architecture doc forbids it; this guide treats violations as migration blockers.

### 2.6 Lifetime and dispose

| Event | What happens |
|-------|----------------|
| Component unmount | Composable `onScopeDispose` → unsubscribe only |
| Store `$dispose` / Pinia `disposePinia` | Runtime `dispose()` → stop refresh/release timers, drop runtime resources |
| User navigates away from feature but store kept | Runtime stays; inactive views should unmount so subscriptions drop |

Who disposes Pinia is an **application shell** decision. Document it once for the host app (playground uses `app.onUnmount(() => disposePinia(pinia))`). Feature stores should still `onScopeDispose(() => runtime.dispose())` when the store itself is disposed.

---

## 3. Component roles

### 3.1 Role definitions

| Role | Responsibility | Typical files |
|------|----------------|---------------|
| **Graph store** | Create graph + runtime; optional use-case actions; dispose runtime | `stores/orders-graph.ts` |
| **Context writer** | Translate user intent into context changes / events / mutations that *start* from this UI | Filter bar, org switcher, wizard step, date picker |
| **Data consumer** | Subscribe via composables; render data and status signals | Tables, detail panes, summary cards |
| **Gate** | Decide whether a consumer subtree mounts (capabilities / feature flags) | Layout wrappers, admin sections |
| **Presentational** | Props in, events out; no runtime | Pure row components, dumb badges |

A single SFC may be writer + light consumer (e.g. filter bar that also shows a count). It must still obey **context ownership** for keys it writes.

### 3.2 Context ownership table (required per migrated workflow)

Before coding, list every context node the workflow uses:

| Context key | Type (summary) | Owner (module/component) | Written when | Cleared / reset when |
|-------------|----------------|--------------------------|--------------|----------------------|
| `SelectedOrgId` | `string \| null` | `OrgSwitcher` / `ordersGraph.selectOrganisation` | User picks org | Logout (session handler) |
| `SelectedTeamId` | `string \| null` | Team picker + org cascade owner | User picks team; **null on org change** | Org change, leave feature |
| `SelectedOrderId` | `string \| null` | Order list selection | Row click | Org/team change, route leave |
| `ViewerRole` | role union | Session bootstrap / auth bridge | Login, role switch | Logout |

**Rules**

1. Each key has **one owner family**. Other components may *request* a change only by calling the owner’s API (store action or injected writer composable).
2. Parent changes that invalidate children use **one transaction** (Recipe 01).
3. New context keys in a PR must update this table (or the feature’s copy of it).

### 3.3 Who may call what

| API | Store | Writer | Consumer | Gate |
|-----|-------|--------|----------|------|
| `createGraph` / `createGraphRuntime` | yes | no | no | no |
| `runtime.transaction` / `setContext` | yes (actions) | yes (owned keys) | no (foreign keys) | no |
| `runtime.mutate` | yes (actions) | yes | sometimes (row actions — prefer store action) | no |
| `runtime.publish` | yes | yes (documented events) | rare | no |
| `useNode` / `useNodes` / `useQuery` | no (store is not a component setup) | optional | yes | no (child mounts instead) |
| `runtime.dispose` | yes (on store dispose) | no | no | no |

---

## 4. Graph store shape

### 4.1 Minimal store

```ts
import { defineStore } from "pinia";
import { markRaw, onScopeDispose } from "vue";
import {
  createGraph,
  createGraphRuntime,
  type GraphRuntime,
} from "vue-dependency-graph/core";
import { ordersGraphNodes } from "./orders-graph-nodes";

export const useOrdersGraphStore = defineStore("ordersGraph", () => {
  const graph = createGraph({ nodes: ordersGraphNodes });

  const runtime: GraphRuntime = markRaw(
    createGraphRuntime(graph, {
      // Set when the API needs a client-side concurrency cap
      // maxConcurrentLoads: 6,
    }),
  );

  onScopeDispose(() => {
    runtime.dispose();
  });

  return {
    runtime,
  };
});
```

### 4.2 Store actions for shared cascades and mutations

Put **orchestration** on the store when more than one component would otherwise open-code the same transaction:

```ts
async function selectOrganisation(orgId: string | null) {
  await runtime.transaction(async (tx) => {
    tx.setContext(SelectedOrgId, orgId);
    tx.setContext(SelectedTeamId, null);
    tx.setContext(SelectedOrderId, null);
  });
}

async function selectTeam(teamId: string | null) {
  await runtime.transaction(async (tx) => {
    tx.setContext(SelectedTeamId, teamId);
    tx.setContext(SelectedOrderId, null);
  });
}

async function placeHold(slotId: string) {
  return runtime.mutate(PlaceHold, { slotId });
}

return {
  runtime,
  selectOrganisation,
  selectTeam,
  placeHold,
};
```

**Still forbidden:** storing the mutation result list or node snapshots on the store as mirrored graph state. Return values from `mutate` may be used by the caller for toasts; authoritative entity state stays in the graph.

### 4.3 Optional timer environment

If the workflow uses refresh/polling or release policies that need visibility/online signals, pass `createBrowserTimerEnvironment()` from `vue-dependency-graph/vue` when creating the runtime (see architecture 07). Keep that construction in the store, not in random components.

### 4.4 Node definition modules

Keep `defineContextNode` / `defineDataNode` / `defineDerivedNode` / `defineMutation` / `defineEvent` / `defineQuery` in plain TS modules (not inside the store factory). The store only assembles `createGraph({ nodes })`.

Namespacing keys for the migration trial (e.g. `orders/selectedOrgId`) reduces collisions if multiple workflows share one process.

---

## 5. Context writers

### 5.1 Responsibilities

1. Own the keys in the ownership table.
2. Prefer **store actions** for cascades used in more than one place.
3. Use **one `transaction`** for any multi-key update (Recipe 01).
4. Debounce high-frequency input **before** calling the graph (Recipe 04).
5. On scope-sensitive switches (org, role), clear dependent selections in the same transaction (Recipe 03).

### 5.2 Example — org switcher

```vue
<script setup lang="ts">
import { useOrdersGraphStore } from "@/stores/orders-graph";

const store = useOrdersGraphStore();

async function onOrgChange(orgId: string) {
  await store.selectOrganisation(orgId);
}
</script>

<template>
  <OrgSelect @change="onOrgChange" />
</template>
```

### 5.3 Example — debounced search context

```ts
import { useDebounceFn } from "@vueuse/core"; // or equivalent

const store = useOrdersGraphStore();

const scheduleSearch = useDebounceFn((q: string) => {
  void store.runtime.transaction(async (tx) => {
    tx.setContext(SearchQuery, q);
  });
}, 200);

function onInput(q: string) {
  scheduleSearch(q);
}
```

Do not debounce inside the graph runtime; debounce the **write**.

### 5.4 Writers that also read

A filter bar may `useNode(ResultCount, { runtime })` to show a badge. That does not grant it ownership of foreign context keys.

### 5.5 Anti-patterns

- Child list row calling `setContext(SelectedOrgId, …)` to “fix” filters.
- Sequential `setContext` without a transaction for a cascade.
- Writing context from a consumer because “the load failed and we need to retry” (retry should re-demand or use documented execute/refresh APIs, not invent new context).

---

## 6. Data consumers

### 6.1 Standard subscription

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useNode } from "vue-dependency-graph/vue";
import { Orders } from "./orders-graph-nodes";
import { useOrdersGraphStore } from "@/stores/orders-graph";

const store = useOrdersGraphStore();

const { data, status, freshness, error, hasSuccessfulValue } = useNode(Orders, {
  runtime: store.runtime,
});

const showBlocker = computed(
  () => status.value === "loading" && !hasSuccessfulValue.value,
);
const showStale = computed(
  () => hasSuccessfulValue.value && freshness.value === "stale",
);
const showHardError = computed(
  () => error.value != null && !hasSuccessfulValue.value,
);
const showSoftError = computed(
  () => error.value != null && hasSuccessfulValue.value,
);
</script>

<template>
  <div v-if="showBlocker" class="skeleton" aria-busy="true" />
  <div v-else-if="showHardError" role="alert">
    {{ error?.message }}
    <!-- retry control: product-specific -->
  </div>
  <div v-else>
    <p v-if="showStale" class="quiet" aria-live="polite">Updating…</p>
    <p v-if="showSoftError" class="banner" role="status">{{ error?.message }}</p>
    <OrderTable :rows="data" />
  </div>
</template>
```

### 6.2 Multiple consumers

Several components may `useNode` the same definition with the same runtime. That is intended. Prefer that over fetching once in a parent and prop-drilling large reactive graphs — prop-drill **ids** if needed; let leaves subscribe for live status.

### 6.3 `useNodes` and `useQuery`

- `useNodes` — fixed list of nodes, combined observation.
- `useQuery` — aliased immutable query definition; `prefetch` / `refresh` delegate to the runtime; still pass `{ runtime }`.

Use queries for page-shaped groups (list + side panel nodes) when the workflow already defines `defineQuery`.

### 6.4 Composable rules (Vue)

**Do not** conditionally call `useNode`:

```ts
// WRONG
if (caps.canViewAudit) {
  useNode(AuditLog, { runtime });
}
```

**Do** gate with a child component:

```vue
<AuditPanel v-if="caps.canViewAudit" />
```

`AuditPanel` setup always calls `useNode` when mounted; unmount releases the subscription.

### 6.5 Consumers must not

- Call `setContext` on keys they do not own.
- Copy `data` into Pinia for caching.
- Assume `status === "loading"` means “wipe the table.”

---

## 7. Status and freshness matrix

The runtime separates **execution status** from **freshness** (ADR-007). UI must use both.

| # | Situation | Typical signals | UI treatment |
|---|-----------|-----------------|--------------|
| A | First paint, no value yet | `status === "loading"`, `!hasSuccessfulValue` | Blocking skeleton for **that region** only |
| B | Has value, reloading / parent changed | `hasSuccessfulValue`, `freshness === "stale"`, and/or `refreshing` / `loading` | **Keep showing data**; quiet updating indicator |
| C | Current success | `success` + `fresh` | Normal |
| D | Initial load failed | `error`, `!hasSuccessfulValue` | Hard error + retry |
| E | Refresh failed, prior value kept | `error`, `hasSuccessfulValue` | Soft banner; keep data |
| F | Successful empty collection | success, `data` empty array / empty shape | Empty state (not an error) |
| G | Forbidden | Gate false; consumer not mounted | Hide or “no access” — not a node error toast |
| H | Aborted generation | Should not surface as domain error | No error toast for abort (Recipe 02 / ADR-018 direction) |

### 7.1 Region scope

Block only the **panel** that is waiting. Do not put a full-page spinner over the shell because one side panel is on first load.

### 7.2 Retry

Product choice, examples:

- User changes context slightly and back (re-demand).
- Explicit `runtime` refresh/execute API if the workflow documents one for that node.
- Mutation retry for failed writes.

Document the chosen retry per screen in the feature notes.

### 7.3 Accessibility

- `aria-busy="true"` on regions in blocking load.
- Soft errors and “Updating…” via polite live regions where appropriate.
- Do not rely on colour alone for stale vs error.

---

## 8. Capabilities, roles, and partial data

Full policy discussion: Recipe 03 and the separate auth modelling notes. UI rules for migration:

1. **Server enforces** access.
2. **Scope contexts** (`EffectiveScope` / org / role) are dependencies of sensitive data nodes.
3. **UI gates** use `v-if` + child mounts so forbidden nodes are not demanded.
4. **Partial rows/fields** come from the API (filtered/redacted DTO). Client-only redaction is display sugar only.
5. **Role/org switch** goes through a store transaction that updates scope and clears invalid selections.

Capabilities may live in:

- ordinary session Pinia (fine for gates), or  
- a graph derived node  

Pick **one** convention for the migrated workflow and state it in the feature’s ownership notes.

---

## 9. Mutations from the UI

1. Prefer `store.someMutation(args)` wrapping `runtime.mutate`.
2. Button pending state from the mutation promise / returned handles — not a mirrored Pinia “orders” array.
3. Optimistic paths follow Recipe 02: rollback on failure; do not treat abort as a business error.
4. After success, either reconcile into graph nodes or rely on events/invalidation; do not also write a second copy into Pinia.

Conflict policy (version check vs refresh vs user choice) is **application-owned**; write it down for the workflow in the migration notes.

---

## 10. Routing, tabs, and lifecycle

### 10.1 Route → context

Single pipeline, e.g. router guard or page-level writer:

```ts
// on route enter
await store.selectOrganisation(route.params.orgId as string);
```

Avoid two writers (guard *and* page filter) fighting the same keys without a defined order.

### 10.2 Route leave

- Consumers unmount → subscriptions release.
- Runtime remains if the Pinia store remains.
- Clear workflow-specific selections in a leave hook **only if** product requires a clean slate next entry; otherwise release policies handle idle data.

### 10.3 Tabs within a feature

Mount **only the active tab’s** consumers (playground pattern). Inactive tabs unmounted → no demand → release policies can drop heavy nodes.

### 10.4 Keep-alive

If you use `<KeepAlive>`, subscriptions may survive tab switches. That is a product choice: either accept retained demand or avoid keep-alive for heavy graph views. Document the choice for the workflow.

---

## 11. Errors, empty, forbidden (summary)

| User-facing case | Cause | UI |
|------------------|-------|-----|
| Empty | Successful load, no rows | Empty state |
| Hard error | Failed with no prior value | Error + retry |
| Soft error | Failed refresh, prior value | Banner + prior data |
| Forbidden | Capability / route | Gate; no subscription |
| Validation | Mutation business rule | Inline form errors from mutation result |

Do not use one generic toast for all four of empty, hard error, soft error, and forbidden.

---

## 12. Testing (Pinia path)

Aligned with architecture 07 and the test strategy:

1. `createPinia()` + install on the app under test.
2. Real feature graph store (or a test store with the same ownership rules).
3. Real `GraphRuntime` — no mocked half-state unless testing pure presentational children.
4. Composables receive **explicit** `{ runtime: store.runtime }`.
5. **Do not** install `createGraphRuntimePlugin` in Pinia-path tests unless the test targets the plugin.
6. Assert:
   - first load blocker then data
   - cascade clears dependents
   - unmount stops updates (no leaks)
   - soft vs hard error presentation if applicable
7. Deterministic loaders/clocks per core test strategy — no real network.

---

## 13. Anti-patterns (quick reference)

| Anti-pattern | Replace with |
|--------------|--------------|
| Mirror node state in Pinia | `useNode({ runtime })` |
| Runtime per widget | One store-owned runtime per workflow |
| Plugin *and* Pinia both “owning” without a rule | Department default: Pinia + explicit runtime |
| Sequential `setContext` for cascades | `runtime.transaction` |
| Conditional `useNode` | Child component + `v-if` |
| Full-page spinner on any node loading | Region-scoped status matrix |
| Wipe table on refresh error | Soft error + keep data |
| Closed-over session in `load` | Scope context dependencies |
| Root subscribe to keep cache forever | Release policy + intentional `retain()` |
| Auth only in UI hide | Server enforce + scope dependencies |

---

## 14. Migration trial checklist

Use for the bounded workflow chosen in the roadmap.

### 14.1 Inventory

- [ ] List context, data, derived, mutation, event, query nodes for the workflow.
- [ ] List existing manual loads, invalidations, and cross-store calls to replace.
- [ ] Fill **context ownership table** (§3.2).
- [ ] Note request-count baseline from the current implementation.

### 14.2 Store and graph

- [ ] One Pinia graph store with `markRaw` runtime and dispose.
- [ ] Node modules pure TS; graph created once.
- [ ] Scope/tenancy contexts on every sensitive data node.
- [ ] Cascades use transactions (Recipe 01).

### 14.3 UI

- [ ] Writers vs consumers split; no foreign `setContext`.
- [ ] Every graph-backed view implements status/freshness matrix (§7).
- [ ] Gates for role-sensitive panels (child mount).
- [ ] No mirrored node state in Pinia.
- [ ] Explicit `{ runtime }` on all composables.

### 14.4 Behaviour validation

- [ ] Initial load, refresh, failure, retry.
- [ ] Context switching and cascade clears.
- [ ] Unmount cleanup / tab switch.
- [ ] Overlapping work / abort does not show as domain error.
- [ ] Mutation optimistic path if in scope (Recipe 02).
- [ ] Measured request counts vs baseline; differences explained.

### 14.5 Diagnostics

- [ ] Enough diagnostics to explain load, invalidation, failure, abort without ad-hoc `console.log` (roadmap exit criteria).

### 14.6 Rollback

- [ ] Document how to disable the graph path for this workflow and revert to the previous loaders.

---

## 15. Lessons learned (fill after trial)

| Date | Observation | Guide change |
|------|-------------|--------------|
| | Request counts higher because … | e.g. adjust debounce guidance |
| | Ownership confusion on key X | e.g. tighten table / store action |
| | Status matrix insufficient for case Y | e.g. extend §7 |
| | | |

This section is intentionally empty until the migration produces evidence.

---

## Appendix A — Full store example (illustrative)

```ts
import { defineStore } from "pinia";
import { markRaw, onScopeDispose } from "vue";
import { createGraph, createGraphRuntime } from "vue-dependency-graph/core";
import {
  SelectedOrgId,
  SelectedTeamId,
  SelectedOrderId,
  Orders,
  OrderDetail,
  PlaceHold,
  ordersNodes,
} from "./orders-graph-nodes";

export const useOrdersGraphStore = defineStore("ordersGraph", () => {
  const graph = createGraph({ nodes: ordersNodes });
  const runtime = markRaw(createGraphRuntime(graph));

  onScopeDispose(() => runtime.dispose());

  async function selectOrganisation(orgId: string | null) {
    await runtime.transaction(async (tx) => {
      tx.setContext(SelectedOrgId, orgId);
      tx.setContext(SelectedTeamId, null);
      tx.setContext(SelectedOrderId, null);
    });
  }

  async function selectTeam(teamId: string | null) {
    await runtime.transaction(async (tx) => {
      tx.setContext(SelectedTeamId, teamId);
      tx.setContext(SelectedOrderId, null);
    });
  }

  async function selectOrder(orderId: string | null) {
    await runtime.transaction(async (tx) => {
      tx.setContext(SelectedOrderId, orderId);
    });
  }

  async function placeHold(slotId: string) {
    return runtime.mutate(PlaceHold, { slotId });
  }

  return {
    runtime,
    selectOrganisation,
    selectTeam,
    selectOrder,
    placeHold,
  };
});
```

## Appendix B — Writer SFC sketch

```vue
<script setup lang="ts">
import { useOrdersGraphStore } from "@/stores/orders-graph";

const store = useOrdersGraphStore();
</script>

<template>
  <div class="filters">
    <OrgSelect @update:model-value="store.selectOrganisation" />
    <TeamSelect @update:model-value="store.selectTeam" />
  </div>
</template>
```

## Appendix C — Consumer SFC sketch

See §6.1.

## Appendix D — Mapping to library concepts

| Guide concept | Library concept |
|---------------|-----------------|
| Graph store owns runtime | `createGraphRuntime` + Pinia + `markRaw` |
| Context writer | `transaction` / `setContext` / `publish` |
| Consumer | `useNode` / `useNodes` / `useQuery` |
| Status matrix | `NodeRuntimeState` status + freshness |
| Cascade | ADR-005 sessions |
| Release on unmount | Subscription dispose + ADR-016 policies |
| No mirror | Architecture 07 “No mirrored state” |

## Appendix E — Agent-oriented summary

When generating code for this department:

1. Create or reuse a **Pinia graph store** with `markRaw(runtime)` and `onScopeDispose(() => runtime.dispose())`.
2. Pass **`{ runtime: store.runtime }`** to every graph composable.
3. Put cascades and shared mutations on **store actions**.
4. Never mirror node snapshots into Pinia.
5. Split **writer** vs **consumer**; update the **ownership table** for new context keys.
6. Render using the **status/freshness matrix**; do not blank on every loading.
7. Gate auth-sensitive panels with **child components**, not conditional `useNode`.
8. Enforce access on the **server**; put scope in **context dependencies**.
```
