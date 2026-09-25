# User Guide

This guide walks through the library end to end, building up one running example - a small storefront, "Banksia" - a piece at a time. For isolated reference on any one function's exact signature, see [`docs/api/01-public-api.md`](../api/01-public-api.md). For _why_ the library is shaped the way it is, see [`docs/architecture/`](../architecture/) and [`docs/decisions/`](../decisions/).

> This package is `private` and not published to a registry - it's consumed directly within this repository or a workspace that depends on it locally, not via `npm install vue-dependency-graph`. The import paths throughout this guide (`vue-dependency-graph/core`, `vue-dependency-graph/vue`) match `package.json`'s `exports` map and resolve correctly from a workspace consumer; if you're writing code inside this repository itself, equivalent relative imports into `src/core`/`src/vue` work the same way.

## Table of contents

1. [What this library is for](#1-what-this-library-is-for)
2. [Core concepts](#2-core-concepts)
3. [Your first graph](#3-your-first-graph)
4. [Reading data in Vue components](#4-reading-data-in-vue-components)
5. [Writing context values](#5-writing-context-values)
6. [Explicit execution: execute, prefetch, and refresh](#6-explicit-execution-execute-prefetch-and-refresh)
7. [Understanding failure](#7-understanding-failure)
8. [Cross-domain invalidation with events](#8-cross-domain-invalidation-with-events)
9. [Keeping data fresh: refresh policies and polling](#9-keeping-data-fresh-refresh-policies-and-polling)
10. [Releasing idle data](#10-releasing-idle-data)
11. [Query groups](#11-query-groups)
12. [Mutations](#12-mutations)
13. [Transactions](#13-transactions)
14. [Limiting concurrency](#14-limiting-concurrency)
15. [Pinia integration](#15-pinia-integration)
16. [Diagnostics and debugging](#16-diagnostics-and-debugging)
17. [Testing your graph](#17-testing-your-graph)
18. [Common patterns](#18-common-patterns)
19. [Troubleshooting](#19-troubleshooting)
20. [Where to go next](#20-where-to-go-next)

---

## 1. What this library is for

If your Vue application has server-backed state with real dependencies between pieces of data - "this price depends on the selected currency," "this page summary depends on that product list," "this stock count needs to reload when a completely different part of the app confirms an order" - you are usually choosing between two bad options: sprinkling `watch()` and manual `fetch` calls through every component that needs the data, or building an ad hoc cache layer that reinvents loading states, staleness, and cancellation badly and differently in every store.

This library is that cache layer, built once, correctly. You declare your data as a graph of typed nodes with explicit dependencies. The runtime figures out what needs to load, when, and in what order; tracks loading/success/error state per node; keeps stale-but-still-useful data visible while a refresh is in flight; cancels obsolete work automatically; and lets you invalidate across unrelated parts of the app through typed events instead of direct store imports.

It is not a replacement for Pinia, and it does not require Vue at all - `src/core` has zero framework dependencies. The Vue adapter (`useNode`, `useNodes`, `useQuery`) is a thin, optional layer converting runtime state into reactive refs.

## 2. Core concepts

**A node** is a typed, immutable description of one piece of graph data. There are three kinds:

- **Context node** - a mutable input you set directly (a selected product, a currency, a feature flag). Always starts with a value.
- **Data node** - asynchronous work (a network call). Declares its dependencies and a `load` function.
- **Derived node** - a synchronous calculation over other nodes' values. No network calls.

A node definition _is_ its own typed handle - you pass the object returned by `defineDataNode(...)` around, not a string. The string `key` you give it is used for identity, diagnostics, and error messages, not for lookup.

**A graph** (`createGraph({ nodes: [...] })`) is the validated, immutable topology built from a set of node definitions: parent/child indexes, cycle detection, duplicate-key detection. Building a graph does not run anything.

**A runtime** (`createGraphRuntime(graph)`) is where the actual values, loading state, and execution live. One graph can back multiple independent runtimes (useful in tests). Creating a runtime does not run anything either - nothing loads until something asks for it.

**A subscription** is what asks. Mounting a component that calls `useNode(SomeNode)` creates a subscription; the runtime notices the subscribed node isn't fresh and loads it automatically, in one coalesced pass, along with whatever ancestors it needs. There is no `loadData()` call to remember.

## 3. Your first graph

Let's build a small storefront. Put node definitions in a module your components import from - they're just values, and can be declared once at module scope.

```ts
// graph/nodes.ts
import { defineContextNode, defineDataNode, defineDerivedNode } from "vue-dependency-graph/core";
import { api } from "../api";

export const CurrentProductId = defineContextNode<string>({
  key: "currentProductId",
  initialValue: "prod-1",
});

export interface Product {
  id: string;
  name: string;
  priceCents: number;
}

export const ProductDetails = defineDataNode({
  key: "productDetails",
  dependencies: [CurrentProductId],
  initialValue: null as Product | null,
  load: ({ get, signal }) => api.getProduct(get(CurrentProductId), signal),
});

export const CurrentCurrency = defineContextNode<"USD" | "AUD" | "EUR">({
  key: "currentCurrency",
  initialValue: "USD",
});

export const DisplayPrice = defineDerivedNode({
  key: "displayPrice",
  dependencies: [ProductDetails, CurrentCurrency],
  derive: ({ get }) => {
    const product = get(ProductDetails);
    if (!product) return "—";
    return formatPrice(product.priceCents, get(CurrentCurrency));
  },
});
```

A few things worth noticing already:

- `ProductDetails.load` receives `get`, which only accepts handles declared in `dependencies` and returns their _value_ type, and `signal`, an `AbortSignal` the runtime manages for you - pass it straight to `fetch` or your API client so an obsolete load is actually cancelled, not just ignored. If your loader ignores the signal, the runtime still stops waiting for an obsolete load (its result is discarded and it does not hold up other loads), but the request itself keeps running.
- `CurrentProductId` starts at `"prod-1"`, a real value from the first render - there's nothing wrong with that, but if a node instead legitimately starts `undefined` (no product selected yet), `ProductDetails.load` will run with `get(CurrentProductId)` returning `undefined` the moment something subscribes, unless you guard against that in `api.getProduct` or in the node itself. There's no built-in "wait until defined" - if you need that, make the dependency explicit in your loader logic.
- `DisplayPrice` never calls `api`. Anything asynchronous belongs in a data node so it shares the one loading/error/cancellation model; a derived node is pure and synchronous.

Now build the graph and a runtime:

```ts
// graph/runtime.ts
import { createGraph, createGraphRuntime } from "vue-dependency-graph/core";
import { CurrentProductId, ProductDetails, CurrentCurrency, DisplayPrice } from "./nodes";

export const graph = createGraph({
  nodes: [CurrentProductId, ProductDetails, CurrentCurrency, DisplayPrice],
});

export const runtime = createGraphRuntime(graph);
```

Registration order in the `nodes` array doesn't matter - the graph resolves it. `createGraph` throws `GraphValidationError` for duplicate keys, missing dependencies, or cycles, so a broken graph fails at startup, not at some unpredictable point later when a particular node happens to execute.

## 4. Reading data in Vue components

```vue
<script setup lang="ts">
import { useNode } from "vue-dependency-graph/vue";
import { ProductDetails, DisplayPrice } from "../graph/nodes";

const { data: product, status, error } = useNode(ProductDetails);
const { data: price } = useNode(DisplayPrice);
</script>

<template>
  <p v-if="status === 'loading'">Loading product...</p>
  <p v-else-if="error">Couldn't load product: {{ error.message }}</p>
  <div v-else>
    <h1>{{ product?.name }}</h1>
    <p>{{ price }}</p>
  </div>
</template>
```

`useNode` creates a graph subscription when the component's effect scope starts and releases it via `onScopeDispose` automatically - no cleanup code to write. Calling it outside `setup()` or an active effect scope throws immediately, rather than silently leaking a subscription.

Mounting this component subscribes to `DisplayPrice`, which pulls in `ProductDetails` and `CurrentCurrency` as required ancestors automatically - you never subscribe to a node's dependencies yourself.

Two components both rendering `ProductDetails` (directly, or transitively through `DisplayPrice`) share one load. The runtime deduplicates in-flight work by node and generation; it does not matter how many components are asking.

For several nodes at once, use `useNodes`:

```ts
const { results, isLoading, isError, errors } = useNodes([ProductDetails, CurrentCurrency]);
const [productState, currencyState] = results;
// productState.value.data -> Product | null, currencyState.value.data -> "USD" | "AUD" | "EUR"
```

`isLoading` is true while _any_ of the nodes is loading or refreshing; `isError`/`errors` aggregate across all of them, while each entry in `results` still holds its own full, independently-readable state (`.data`, `.status`, `.freshness`, `.error`, `.hasSuccessfulValue`) if you need to distinguish which node is the problem.

Remember `status`/`freshness`/`hasSuccessfulValue` are independent facts (see [ADR-007](../decisions/ADR-007-status-freshness-separation.md)): after a failed refresh, `useNode(ProductDetails)` can report `status: "error"` while `data` still holds the last successful product. Don't treat "there's an error" as "there's no data" - render both, if useful:

```vue
<p v-if="error" class="warning">Couldn't refresh - showing last known details.</p>
<h1>{{ product?.name }}</h1>
```

## 5. Writing context values

Context is the only kind of node you write to directly:

```ts
runtime.setContext(CurrentCurrency, "AUD");
```

This is synchronous - it doesn't return a promise. It updates the value, invalidates every descendant (here, `DisplayPrice`), and requests one coalesced scheduler pass for whatever is currently subscribed and now stale. If a component has `useNode(DisplayPrice)` mounted, it re-renders once the microtask runs; you don't await anything.

Setting `CurrentProductId` invalidates `ProductDetails`, which invalidates `DisplayPrice` transitively - one `setContext` call, one coalesced re-execution of everything downstream that's actually subscribed.

## 6. Explicit execution: execute, prefetch, and refresh

Sometimes you want to load data without waiting for a component to subscribe, without a persistent subscription (route-level prefetching), or force a reload of something you already have (a manual "refresh" button). Three runtime methods cover this, all built on the same underlying execution engine as automatic subscription-driven loading - none of them is a separate code path with its own bugs to have:

```ts
// The base primitive: resolve targets and their ancestors, skipping
// anything already fresh. Ownership isn't persistent - this doesn't
// keep the node loaded the way a subscription would.
await runtime.execute([ProductDetails]);

// prefetch(...) is execute(...) tagged with a distinct diagnostic
// origin ("prefetch" instead of "explicit") - same behavior, clearer
// intent and diagnostics when you're specifically warming a cache
// ahead of navigation (e.g. on hover over a product card):
await runtime.prefetch([ProductDetails]);

// A refresh button:
async function onRefreshClick() {
  await runtime.refresh([ProductDetails]);
}
```

`refresh` is the odd one out: unlike `execute`/`prefetch`, it forces re-execution even if the node is currently fresh, and only accepts data and derived nodes (context nodes are changed through `setContext`, not refreshed). A `prefetch` and a component mounting at the same time share one request rather than firing two, since both go through the same execution engine and the same in-flight deduplication.

A refresh that returns a value equal (via `Object.is`) to the previous one does not invalidate descendants - `DisplayPrice` won't recompute if `ProductDetails.load()` happens to return the exact same object reference (which, for a fresh network response, it normally won't, but matters for derived nodes reacting to a no-op refresh).

## 7. Understanding failure

If `ProductDetails.load` throws, `ProductDetails` records `status: "error"`. `DisplayPrice`, which depends on it, does not execute at all - it's **blocked**, not failed, because it never got a chance to run. This distinction matters for anything else in the same `execute`/subscription pass that _doesn't_ depend on the failure - it keeps loading normally. One broken data source blocks its own descendants, not everything on the page (see [ADR-008](../decisions/ADR-008-branch-scoped-failures.md)).

If you call `runtime.execute(...)`, `runtime.prefetch(...)`, or `runtime.refresh(...)` explicitly and something in the requested set fails, the call rejects with `GraphExecutionError`, which aggregates every failure and every blocked node from that call:

```ts
import { GraphExecutionError } from "vue-dependency-graph/core";

try {
  await runtime.refresh([ProductDetails]);
} catch (error) {
  if (error instanceof GraphExecutionError) {
    for (const failure of error.failures) {
      console.error(failure.nodeKey, failure.kind, failure.error);
    }
  }
}
```

Automatic (subscription-driven) failures don't throw anywhere - there's no promise to catch. They land in `runtime.getSchedulerState().error` and in the failed node's own `error` field, which `useNode` already exposes. The scheduler does not retry automatically; a later context change, new subscription, or explicit refresh is what tries again. If you want a "retry" button after a failed automatic load, wire it to `runtime.refresh([FailedNode])`.

## 8. Cross-domain invalidation with events

Say a warehouse system confirming a stock update somewhere else in the app should invalidate inventory data here, without either module importing the other's store. Typed events are how:

```ts
// events/inventory.ts
import { defineEvent } from "vue-dependency-graph/core";

export const StockChanged = defineEvent<{
  productId: string;
  inStock: boolean;
}>("stock.changed");
```

```ts
// graph/nodes.ts (product module - never imports the warehouse module)
import { whenEvent } from "vue-dependency-graph/core";

export const Inventory = defineDataNode({
  key: "inventory",
  dependencies: [CurrentProductId],
  initialValue: null,
  invalidatedBy: [
    whenEvent(
      StockChanged,
      [CurrentProductId],
      ({ payload, get }) => payload.productId === get(CurrentProductId),
    ),
  ],
  load: ({ get }) => api.getInventory(get(CurrentProductId)),
});
```

```ts
// somewhere in the warehouse module, after a confirmed stock update:
runtime.publish(StockChanged, { productId, inStock });
```

The predicate (`when`) is synchronous and side-effect free, and is checked against committed dependency values, not against the event payload alone - here, only a stock update for the _currently viewed_ product invalidates `Inventory`. A publication that matches nothing is silent; there's no error for "nobody was listening."

`whenEvent`'s second argument is the exact set of dependencies `when` needs to read - it doesn't have to be the node's entire `dependencies` list, just the ones the predicate actually uses. Passing it explicitly (rather than writing `{ event, when }` inline) is what lets `payload` and `get` be fully typed with no annotation, and lets `get` reject a node that isn't in that list - the same guarantee `load` and `derive` already give you.

This is in-memory, single-runtime delivery only - it does not cross tabs, does not hit a server, and doesn't guarantee replay. If you need server-driven invalidation (e.g. a websocket push from the warehouse system), have your transport layer validate the incoming message and call `runtime.publish(...)` itself.

## 9. Keeping data fresh: refresh policies and polling

A refresh policy is graph metadata - attach it to a data node and the runtime handles timers and retries for you, only while the node has a subscriber.

```ts
import { staleAfter, refreshInterval, pollUntil } from "vue-dependency-graph/core";

// Reload automatically once the data is more than 30 seconds old
// and something is still subscribed. Good for details that rarely
// change - a product's name and description don't need to be
// refetched on every render, just occasionally.
export const ProductDetails = defineDataNode({
  key: "productDetails",
  dependencies: [CurrentProductId],
  initialValue: null as Product | null,
  load: ({ get, signal }) => api.getProduct(get(CurrentProductId), signal),
  refresh: staleAfter({ durationMs: 30_000 }),
});

// Or: reload every 10 seconds on a fixed interval while subscribed -
// a backstop for data that's supposed to update via an event (like
// Inventory above) but might occasionally miss one.
refresh: refreshInterval({ intervalMs: 10_000 });

// Or: for a long-running server-side process, poll until a condition
// is met - here, an order making its way to "shipped" after checkout.
export const OrderStatus = defineDataNode({
  key: "orderStatus",
  dependencies: [CurrentOrderId],
  initialValue: null,
  load: ({ get, signal }) => api.getOrderStatus(get(CurrentOrderId), signal),
  refresh: pollUntil({
    intervalMs: 3_000,
    stopWhen: (order) => order?.status === "shipped",
    failWhen: (order) => order?.status === "cancelled",
    timeoutMs: 60_000,
  }),
});
```

A node has at most one policy. Context and derived nodes cannot declare one - `createGraph` rejects that at validation time. Polling stops automatically when the last subscriber goes away, and resumes from a clean cycle on the next subscription, so you don't need to manually tear down timers when a component unmounts.

`pollUntil` reads progress the same way any other data node does - through `data`, on every intermediate response, not through a separate callback. If your order-status endpoint returns `{ status: "confirmed" }` then later `{ status: "shipped" }`, render `status` straight from `useNode(OrderStatus).data` as it updates on each poll.

## 10. Releasing idle data

A node's value stays in memory for as long as the runtime exists - by default, forever, even after every subscriber has gone away. For most graphs that's fine: a fixed, small set of nodes isn't worth worrying about. For a node that can hold something genuinely large (a big list, a large blob), you can have the runtime release it automatically once nothing needs it any more:

```ts
import { releaseAfter, retain } from "vue-dependency-graph/core";

export const ProductDetails = defineDataNode({
  key: "productDetails",
  dependencies: [CurrentProductId],
  initialValue: null as Product | null,
  load: ({ get, signal }) => api.getProduct(get(CurrentProductId), signal),
  release: releaseAfter({ durationMs: 60_000 }),
});
```

Or set one default for every data node in the graph, and opt specific nodes out:

```ts
const runtime = createGraphRuntime(graph, { releaseAfterMs: 5 * 60_000 });

export const Cart = defineDataNode({
  key: "cart",
  initialValue: { items: [] },
  load: () => api.getCart(),
  release: retain(), // never released automatically, even though the runtime has a default - the cart is needed everywhere in the app
});
```

Resolution order: a node's own `release` always wins over the runtime's `releaseAfterMs` default, including `retain()` explicitly opting a node out. A node with neither falls back to the runtime default; a runtime with no default and nodes with no policy of their own behaves exactly as if this feature didn't exist.

The timer starts the moment a node has _no_ subscribers at all - not just no direct `useNode` caller, but no other node depending on it either. A node kept alive only because something else still needs it as a dependency is not released; releasing it would just force that other node to reload it immediately. Resubscribing before the timer fires cancels it - the existing value is reused exactly as if nothing had happened, no reload needed.

When the timer fires, the node resets to exactly the shape it had before it ever loaded - `data` back to `initialValue`, no successful value, `status: "idle"` - so a later subscribe triggers a genuinely fresh `load()`, not a stale cached value. Context and derived nodes can't declare a release policy at all: a context value is caller-provided input, not cache, and releasing it would silently discard state you set rather than just cost a reload.

A release shows up in diagnostics as a `node.value-released` event, and in the devtools Timeline under its own "release" filter - useful for confirming large data actually gets reclaimed on a long-running page (browsing a big catalog, say) rather than just trusting the configuration. See [ADR-016](../decisions/ADR-016-value-release-policies.md) for the full design reasoning, including why this is timer-based rather than, say, an LRU-style bounded count.

## 11. Query groups

When a screen needs several related nodes together - and you don't want to repeat that list of nodes at every call site - group them once:

```ts
import { defineQuery } from "vue-dependency-graph/core";

export const ProductPage = defineQuery({
  key: "product-page",
  nodes: {
    product: ProductDetails,
    price: DisplayPrice,
    inventory: Inventory,
  },
});
```

```ts
const page = useQuery(ProductPage);

page.nodes.product.data.value; // Product | null
page.nodes.price.data.value; // string, formatted
page.isLoading.value; // true if any aliased node is loading
page.isError.value; // true if any aliased node has an error
page.errors.value; // the errors, aggregated
page.isSuccess.value;

await page.prefetch();
await page.refresh();
// equivalently, from the runtime directly:
await runtime.prefetchQuery(ProductPage);
await runtime.refreshQuery(ProductPage); // context aliases excluded - use setContext for those
```

Each aliased entry under `page.nodes` exposes the same computed refs `useNode` would give you individually. A query definition doesn't create new runtime state - it's a typed, named grouping of the same underlying nodes `useNodes` would subscribe to anyway, declared once and reused everywhere the page needs that combination.

## 12. Mutations

Reads go through data nodes. Writes - commands with a server round-trip that should update the cache on success - go through mutations. A mutation is not a node: it doesn't participate in dependency execution, isn't deduplicated, and doesn't consume `maxConcurrentLoads`.

### Start with confirmed success only

Prefer the smallest integration first - no optimistic update, just reconciling the cache after a confirmed success:

```ts
import { defineMutation } from "vue-dependency-graph/core";

interface AddToCartInput {
  productId: string;
  quantity: number;
}

const AddToCart = defineMutation({
  key: "cart.add",
  execute: ({ input, signal }: { input: AddToCartInput; signal: AbortSignal }) =>
    api.addToCart(input, signal),
});

async function onAddToCart(productId: string, quantity: number) {
  await runtime.mutate(
    AddToCart,
    { productId, quantity },
    {
      onSuccess: (effects, updatedCart) => {
        effects.update(Cart, () => updatedCart);
        effects.invalidate([Inventory]);
      },
    },
  );
}
```

Use `update(...)` when the response contains enough authoritative data to update a successful data node immediately - here, the server's returned cart. Use `invalidate(...)` when the server remains authoritative or the node has never loaded successfully - here, `Inventory`, since the add-to-cart response doesn't itself carry updated stock counts. Use `publish(...)` for typed cross-domain invalidation already represented by graph event declarations (see [§8](#8-cross-domain-invalidation-with-events)).

For event `when` predicates checked as part of a mutation's success effects, read direct data or context dependencies whenever those values participate in the same draft. Don't read a derived dependency affected by the mutation's optimistic targets, a direct success update, or explicit invalidation - it hasn't recomputed during preparation, so the runtime rejects that read instead of evaluating stale data. Unaffected derived dependencies remain valid to read.

The success callback and all update functions must be synchronous. The runtime validates the complete draft before changing graph state.

`effects.update(...)` requires `current` to be treated as read-only - return a new array/object, never mutate `current` in place:

```ts
// Supported
effects.update(Cart, (current) => ({ ...current, items: [...current.items, newItem] }));

// Invalid
effects.update(Cart, (current) => {
  current.items.push(newItem);
  return current;
});
```

Development and test builds actively detect and reject in-place writes through plain arrays and plain objects, including nested plain values - production builds skip that check for performance, so don't rely on it catching a bug you haven't already caught in tests. Non-plain values aren't guarded either way, so immutable replacement remains required for `Date`, `Map`, `Set`, class instances, and similar.

### Add optimistic behaviour only once the user benefit is clear

Optimistic updates require an existing successful value - they must not reinterpret a placeholder `initialValue` as loaded server state.

```ts
await runtime.mutate(
  AddToCart,
  { productId, quantity },
  {
    optimistic: (effects, input) => {
      effects.update(Cart, (current) => ({
        ...current,
        items: [...current.items, { productId: input.productId, quantity: input.quantity }],
      }));
    },
    onSuccess: (effects, updatedCart) => {
      effects.update(Cart, () => updatedCart);
      effects.invalidate([Inventory]);
    },
    classifyFailure: (error) =>
      error instanceof Error && error.message === "OUT_OF_STOCK" ? "rejected" : "unknown",
  },
);
```

`classifyFailure` matters: only classify `"rejected"` when you have real evidence the server didn't commit the command (a validation response, an explicit business rejection - here, a confirmed "out of stock"). Anything ambiguous - a timeout, a dropped connection, a malformed response - must be `"unknown"`, which keeps the optimistic value visible as unconfirmed rather than risking a false rollback of a command that may have actually succeeded.

### Idempotency keys

The framework does not generate or persist idempotency keys. Commands that may be retried after an unknown outcome should use a domain-appropriate key generated before the first request and reused for retries of that logical command - `placeOrder` is the clearest case: if the connection drops after the request was sent, you must not let a naive retry double-charge the customer.

```ts
const input = {
  commandId: crypto.randomUUID(), // generated once, before the first attempt
  cartId,
  shippingAddressId,
};

await runtime.mutate(PlaceOrder, input, {
  classifyFailure: (error) => (isKnownRejectedResponse(error) ? "rejected" : "unknown"),
});
// If this rejects with GraphMutationOutcomeUnknownError, retry with the
// *same* input.commandId - never generate a new one for a retry of the
// same logical order.
```

The server must define the key's scope, retention period, duplicate response, and conflict behaviour. Do not generate a new key for each retry of the same logical action, and do not assume an HTTP method is automatically idempotent.

### Handling mutation errors

`runtime.mutate` can reject with one of five error types, each extending a common `GraphMutationError` base with a `code` field (`"CONFLICT"`, `"OUTCOME_UNKNOWN"`, `"ROLLBACK_CONFLICT"`, `"STATE"`, or `"RECONCILIATION"`). Catch `GraphMutationError` for a single broad handler - log it, show a generic "that didn't work" toast, whatever your default is - and narrow with `instanceof` on a specific subclass (or `switch` on `.code`) wherever a failure needs different handling:

```ts
import { GraphMutationError, GraphMutationOutcomeUnknownError } from "vue-dependency-graph/core";

try {
  await runtime.mutate(AddToCart, { productId: "prod-1", quantity: 1 });
} catch (error) {
  if (error instanceof GraphMutationOutcomeUnknownError) {
    showPendingConfirmationBanner();
  } else if (error instanceof GraphMutationError) {
    showGenericMutationError(error);
  } else {
    throw error;
  }
}
```

The five, each corresponding to a distinct situation:

**`GraphMutationConflictError`** - another unresolved optimistic mutation already owns at least one of the nodes this call would update. The classic case is a quantity stepper on a cart line clicked rapidly: the second click's optimistic update can't safely apply on top of the first click's still-unconfirmed one. The conflicting request never started. Typical handling is disabling the control while a mutation on the same node is in flight, rather than catching this after the fact.

**`GraphMutationOutcomeUnknownError`** - the server outcome is ambiguous, e.g. the connection dropped after `placeOrder`'s request was sent. Read `cause` for the original remote failure and `nodeKeys` for the affected optimistic state. Tell the user confirmation is pending, avoid firing an automatic duplicate command, and let the scheduled authoritative reload complete - or retry with the same idempotency key, per the section above.

**`GraphMutationRollbackConflictError`** - a known rejection arrived after newer graph work changed the captured state. The classic case: you optimistically added an item to the cart, but it sold out (an `Inventory`-invalidating event arrived) before the add request itself came back rejected. Rolling back to the pre-optimistic value would discard that newer state, so no old snapshot is restored - `cause` holds the original rejection, `nodeKeys` the affected nodes. Preserve the newer values and let authoritative reconciliation run.

A successful known-rejection rollback restores prior logical values and statuses, but not old generation numbers - rollback is a new committed transition, so generations keep increasing and obsolete asynchronous work remains obsolete. If the restored snapshot was already stale and remains subscribed, rollback automatically resumes authoritative graph work through the existing scheduler; you don't need a second refresh just because rollback restored stale state, and `whenSettled()` waits for this recovery work too.

**`GraphMutationStateError`** - the local effect draft itself was invalid: a never-successful update target, a malformed runtime target, an `update` call that mutated `current` in place. This is an application integration error rather than a remote outcome - fix the `optimistic`/`onSuccess` callback rather than catching this.

**`GraphMutationReconciliationError`** - the remote command succeeded, but local success reconciliation failed (e.g. `effects.update` rejecting a malformed server response). `remoteSucceeded` is always `true` here: the server has already committed the change, only the local graph update failed to apply. Don't retry or roll back automatically - read `mutationKey`, `nodeKeys`, and `cause`, keep any optimistic values presented as stale confirmation-pending state, and let an authoritative reload settle. For non-optimistic mutations, a local success-effect failure surfaces as its original error instead, since there's no optimistic projection to recover.

## 13. Transactions

A transaction batches several `setContext`/`publish` calls so observers only ever see the fully-committed result, never an intermediate state:

```ts
await runtime.transaction(async (transaction) => {
  transaction.setContext(CurrentProductId, nextProductId);
  transaction.setContext(CurrentCurrency, "AUD");
  await someLocalValidation();
});
```

Both context writes above commit together, in one notification and one scheduler pass - no subscribed component sees `CurrentProductId` updated while `CurrentCurrency` is still the old value. If the callback throws, both staged writes are discarded; nothing was ever visible.

This is local atomicity only - it batches _this runtime's_ state, not a backend transaction. A `runtime.mutate(...)` call inside a transaction body is not part of it and cannot see staged context values; don't hold a transaction open around remote work, since mutation success effects already provide their own single synchronous commit.

Plain `runtime.setContext(...)` calls made elsewhere while a transaction is open are unaffected by it - they commit immediately, independent of whatever the transaction eventually does. Two transactions that stage the same context concurrently resolve by first-commit-wins: the second to commit gets `GraphTransactionConflictError`, and its staged work is discarded, not partially applied.

## 14. Limiting concurrency

By default there's no cap on how many data-node loads can be in flight. If a context change invalidates a lot of subscribed nodes at once, that can mean a burst of dozens of simultaneous requests. Cap it per runtime:

```ts
const runtime = createGraphRuntime(graph, { maxConcurrentLoads: 6 });
```

This only gates `load()` calls (derived nodes are synchronous and never queue). It applies across explicit execution, scheduler work, prefetch, and refresh alike - one shared budget, not one per call site. A queued load that gets aborted (its subscriber went away, or it was superseded) leaves the queue without ever calling `load()`. Mutation `execute` calls don't consume this budget either - a `placeOrder` command can start even while a burst of product loads is queued behind it.

## 15. Pinia integration

If your app already has Pinia installed, own the runtime inside a store rather than installing a separate plugin:

```ts
// stores/dependency-graph.ts
import { defineStore } from "pinia";
import { markRaw, onScopeDispose } from "vue";
import { createGraphRuntime } from "vue-dependency-graph/core";
import { graph } from "../graph/runtime";

export const useDependencyGraphStore = defineStore("dependencyGraph", () => {
  const runtime = markRaw(createGraphRuntime(graph));
  onScopeDispose(() => runtime.dispose());
  return { runtime };
});
```

```vue
<script setup lang="ts">
import { useNode } from "vue-dependency-graph/vue";
import { useDependencyGraphStore } from "../stores/dependency-graph";
import { ProductDetails } from "../graph/nodes";

const { runtime } = useDependencyGraphStore();
const { data: product } = useNode(ProductDetails, { runtime });
</script>
```

`onScopeDispose(() => runtime.dispose())` stops the runtime's refresh and release timers when the store is disposed (`store.$dispose()` or `disposePinia(pinia)`). Pinia doesn't dispose itself when the app unmounts, so call `app.onUnmount(() => disposePinia(pinia))` in `main.ts` if you want that.

`markRaw` matters - the runtime is a closure-based service with its own change notification, not something Vue needs to (or should) make reactive itself. Never copy node data, status, or subscription counts into separate Pinia refs; that creates a second source of truth with its own consistency rules to get right. Read graph state through `useNode`/`useNodes`/`useQuery`, always, even from inside a Pinia store's other actions if you need to read current values there.

If you don't already have Pinia, use the plugin instead:

```ts
// main.ts
import { createGraphRuntimePlugin } from "vue-dependency-graph/vue";
app.use(createGraphRuntimePlugin(runtime));
```

The plugin disposes the runtime when the app unmounts. If the runtime is shared or owned elsewhere, pass `{ disposeOnUnmount: false }` as a second argument.

```ts
// any component, no explicit runtime option needed:
const { data } = useNode(ProductDetails);
```

An explicit `{ runtime }` option always takes precedence over the injected one, so the two approaches can coexist if you need to point one specific component at a different runtime (a test double, for instance).

## 16. Diagnostics and debugging

For "why did this load, and what caused it," turn on structured diagnostics at runtime construction:

```ts
import { createInMemoryGraphDiagnostics } from "vue-dependency-graph/core";

const diagnostics = createInMemoryGraphDiagnostics({ capacity: 500 });
const runtime = createGraphRuntime(graph, { diagnostics: { sink: diagnostics } });

// later, anywhere:
const recentEvents = diagnostics.getEvents();
const metrics = diagnostics.getMetrics();
```

Every event carries a deterministic operation ID and, where relevant, a cause ID linking it back to whatever triggered it - a subscription, a context change, an event publication, a transaction commit. This is how you answer "why did `ProductDetails` reload just now" without adding `console.log` to a loader. Diagnostics are entirely observational: a sink that throws doesn't affect runtime behavior, and nothing here changes if you omit the option.

For a point-in-time export (bug reports, a debug panel), take a snapshot:

```ts
const snapshot = runtime.createDiagnosticSnapshot();
```

Node values are omitted from snapshots by default - opt a specific node in explicitly if you need its value included, or provide a redactor, rather than turning this off globally.

For an interactive view instead of raw events and snapshots, mount the devtools panel against the same runtime and collector:

```vue
<script setup lang="ts">
import { GraphDevtoolsPanel } from "vue-dependency-graph/devtools";
</script>

<template>
  <GraphDevtoolsPanel :runtime="runtime" :diagnostics="diagnostics" />
</template>
```

It shows the dependency graph, a per-node inspector, the same timeline as `diagnostics.getEvents()` filtered and labeled, and metrics - plus export/import for taking a snapshot out of one session and loading it back later with no live runtime attached. See [`docs/api/01-public-api.md`](../api/01-public-api.md#devtools) for the full reference.

## 17. Testing your graph

Keep tests independent of real timers and real network calls. For loaders, use deferred promises you control the resolution of, not real `fetch`:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it("shows the updated cart after a successful mutation", async () => {
  const added = deferred<Cart>();
  const AddToCart = defineMutation({
    key: "cart.add",
    execute: () => added.promise,
  });
  const runtime = createGraphRuntime(graph);

  const mutation = runtime.mutate(
    AddToCart,
    { productId: "prod-1", quantity: 1 },
    {
      onSuccess: (effects, cart) => effects.update(Cart, () => cart),
    },
  );
  added.resolve({ items: [{ productId: "prod-1", quantity: 1 }] });
  await mutation;

  expect(runtime.getState(Cart).data).toEqual({
    items: [{ productId: "prod-1", quantity: 1 }],
  });
});
```

For refresh policies, release policies, and polling, real timers make tests slow and flaky. Inject a deterministic environment instead, via `GraphRuntimeOptions.timerEnvironment` - the same environment backs both refresh and release policies, so one fake clock covers both. The shape is `TimerEnvironment` from `vue-dependency-graph/core`; `createDefaultTimerEnvironment()` shows exactly which functions to fake (`now`, `setTimeout`, `clearTimeout`, `random`, `isPaused`, `onPauseChange`):

```ts
function createFakeTimerEnvironment() {
  let currentTime = 0;
  const timers = new Map<number, { dueAt: number; callback: () => void }>();
  let nextHandle = 1;

  return {
    environment: {
      now: () => currentTime,
      setTimeout: (callback: () => void, delayMs: number) => {
        const handle = nextHandle++;
        timers.set(handle, { dueAt: currentTime + delayMs, callback });
        return handle;
      },
      clearTimeout: (handle: unknown) => timers.delete(handle as number),
      random: () => 0.5,
      isPaused: () => false,
      onPauseChange: () => () => undefined,
    },
    advance(ms: number) {
      currentTime += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.dueAt <= currentTime) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
  };
}

it("reloads once the data is stale", async () => {
  const { environment, advance } = createFakeTimerEnvironment();
  const runtime = createGraphRuntime(graph, { timerEnvironment: environment });

  const subscription = runtime.subscribeNodes([ProductDetails]);
  await runtime.whenSettled();
  const loadCountAfterFirstLoad = api.getProduct.mock.calls.length;

  advance(30_000); // matches ProductDetails' staleAfter({ durationMs: 30_000 })
  await runtime.whenSettled();

  expect(api.getProduct.mock.calls.length).toBe(loadCountAfterFirstLoad + 1);
  subscription.unsubscribe();
});
```

For Vue components, use real `createGraph`/`createGraphRuntime` instances (not mocks) with Vue Testing Library, and pass the runtime explicitly rather than relying on global plugin installation - it keeps each test's runtime isolated from every other test's.

## 18. Common patterns

**Route-level prefetching.** Call `runtime.prefetch([...])` in a route guard or loader before navigation, so the destination component's `useNode` calls find warm data instead of triggering a fresh load on mount.

**A manual "retry" after an automatic failure.** Automatic failures don't retry themselves (see [§7](#7-understanding-failure)). Wire a retry button to `runtime.refresh([FailedNode])`.

**Derived aggregate state across several nodes.** Prefer one derived node over recomputing the same combination inline in every component that needs it - it gets its own status/error/freshness tracking for free, and other nodes can depend on it too.

**Don't reinterpret `initialValue` as loaded data.** A data node's `initialValue` exists so the node has _something_ to render before the first load completes - it is not a cache-primed value. In particular, don't build an optimistic mutation update on top of a node that has never successfully loaded; the guide in [§12](#12-mutations) calls this out explicitly.

## 19. Troubleshooting

**"My component never shows data."** Check that something is actually subscribed - `useNode`/`useNodes`/`useQuery` inside an active component scope. A node with no subscriber and no explicit `execute`/`prefetch`/`refresh` call simply never runs; that's by design (see [ADR-004](../decisions/ADR-004-subscription-driven-loading.md)), not a bug.

**"A context change didn't reload my derived node."** Confirm the derived node actually declares the context (or an intermediate node depending on it) in its `dependencies`. A dependency the loader/derive function reads via closure instead of through `get(...)` is invisible to the graph - it won't trigger invalidation.

**"Two components load the same data twice."** This shouldn't happen for the same node at the same generation - the runtime deduplicates automatically. If you're seeing duplicate requests, check whether the two components are actually depending on the _same_ node handle (imported from the same module) rather than two separately-defined nodes that happen to have the same key - that's a graph validation error (`createGraph` rejects duplicate keys), not silent duplication, so it's more likely two distinct nodes with genuinely different keys.

**"My refresh policy never fires."** Policies only run while the node has a subscriber. If nothing is currently mounted with `useNode`/`useNodes`/`useQuery` on that node, there's no timer running - that's intentional, not a missed edge case.

**"A node reloaded even though a component using it is still mounted."** If that node has a `release` policy (its own, or the runtime's `releaseAfterMs` default), check whether it's still subscribed only _indirectly_ - through another node that depends on it, with nothing subscribing to it directly and nothing subscribing to anything that needs it either. Release only fires when a node has no subscribers at all, direct or required, so a reload after release means it genuinely had none for the configured duration - not that the direct/required distinction stopped applying.

**"An optimistic mutation update disappeared without an error."** Check whether newer graph work (a context change, another mutation, a refresh) touched the same node before your mutation settled. A known rejection that arrives after newer state changed rejects with `GraphMutationRollbackConflictError` specifically so this case is visible rather than silently overwriting the newer data - see [§12](#12-mutations).

## 20. Where to go next

- [`docs/api/01-public-api.md`](../api/01-public-api.md) - complete reference for every public function and option.
- [`docs/architecture/`](../architecture/) - how the pieces fit together and why, in depth.
- [`docs/decisions/`](../decisions/) - the reasoning and alternatives behind each major design choice.
- [`docs/testing/01-test-strategy.md`](../testing/01-test-strategy.md) - how this library's own test suite is organized, useful as a model for your own graph's tests.
