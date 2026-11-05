# Vue Dependency Graph

Vue Dependency Graph is a TypeScript-first data orchestration library for Vue applications. You declare your application data as a dependency graph; the runtime coordinates demand, loading, invalidation, transactions, polling, events, derived state, failures, and diagnostics, so components just read what they need.

## Status

Version `0.1.0` is a pre-1.0 release. The runtime includes graph execution and scheduling, Vue integration, isolated atomic transaction sessions, typed events, query groups, refresh policies and polling, typed and optimistic mutations, diagnostics, devtools, automatic value release, retention hardening, and overlapping scheduler flushes. All of it is covered by the validation suite described under [Development](#development).

While the version is `0.x`, the public API may change between minor versions; every release's changes are listed in the [changelog](CHANGELOG.md). API stabilization (1.0) and npm publication are gated on a bounded trial in an existing application. See the [roadmap](docs/ROADMAP.md) and [compatibility and release contract](docs/maintenance/compatibility.md).

## Install

Releases are distributed as tarballs on this repository's GitHub Releases page. Download `vue-dependency-graph-x.y.z.tgz` and install it:

```bash
pnpm add ./vue-dependency-graph-x.y.z.tgz
```

Requirements: Node 22.13 or newer for tooling, and Vue 3.5 or newer for the `/vue` and `/devtools` entry points. Vue is an optional peer dependency, so `/core` works without it. The package is ESM-only and has three entry points plus a stylesheet:

| Import                                    | Contents                                                          |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `vue-dependency-graph/core`               | Framework-agnostic graph engine, runtime, mutations, diagnostics. |
| `vue-dependency-graph/vue`                | Vue plugin and the `useNode`, `useNodes`, `useQuery` composables. |
| `vue-dependency-graph/devtools`           | Optional inspector panel and protocol transforms.                 |
| `vue-dependency-graph/devtools/style.css` | The panel's stylesheet; import it once where you mount the panel. |

## Quickstart

The examples use a small fictional storefront, "Banksia", that the [user guide](docs/guides/00-user-guide.md) builds up in full.

### 1. Declare the graph

Context nodes are values you set, data nodes load from your API, derived nodes compute from other nodes, and mutations are writes. `get` only accepts a node's declared dependencies, and `signal` cancels a request that has become obsolete.

```ts
// graph.ts
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineMutation,
  type MutationExecuteContext,
} from "vue-dependency-graph/core";

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface CartState {
  readonly items: readonly { readonly productId: string; readonly quantity: number }[];
}

// A context node is a value you set. Everything downstream reacts to it.
export const CurrentProductId = defineContextNode<string>({
  key: "currentProductId",
  initialValue: "prod-1",
});

// A data node loads from your API. `get` only accepts declared dependencies,
// and `signal` cancels the request if it becomes obsolete.
export const ProductDetails = defineDataNode({
  key: "productDetails",
  dependencies: [CurrentProductId],
  initialValue: null as Product | null,
  load: async ({ get, signal }) => {
    const response = await fetch(`/api/products/${get(CurrentProductId)}`, { signal });
    return (await response.json()) as Product;
  },
});

// A derived node is a pure, synchronous computation over other nodes.
export const DisplayPrice = defineDerivedNode({
  key: "displayPrice",
  dependencies: [ProductDetails],
  derive: ({ get }) => {
    const product = get(ProductDetails);
    return product ? `$${(product.priceCents / 100).toFixed(2)}` : "—";
  },
});

export const Cart = defineDataNode({
  key: "cart",
  dependencies: [],
  initialValue: { items: [] } as CartState,
  load: async ({ signal }) => {
    const response = await fetch("/api/cart", { signal });
    return (await response.json()) as CartState;
  },
});

// A mutation is a write. `onSuccess` here is a default for every call.
export const AddToCart = defineMutation({
  key: "cart.add",
  execute: async ({
    input,
    signal,
  }: MutationExecuteContext<{ productId: string; quantity: number }>) => {
    const response = await fetch("/api/cart/items", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
    return (await response.json()) as CartState;
  },
  onSuccess: (effects) => {
    effects.invalidate([Cart]);
  },
});

export const runtime = createGraphRuntime(
  createGraph({ nodes: [CurrentProductId, ProductDetails, DisplayPrice, Cart] }),
);
```

### 2. Read it in a component

Reading a node subscribes to it, which loads it and everything it depends on. Two components reading the same node share one request.

```ts
// main.ts
import { createApp } from "vue";
import { createGraphRuntimePlugin } from "vue-dependency-graph/vue";
import App from "./App.vue";
import { runtime } from "./graph";

createApp(App).use(createGraphRuntimePlugin(runtime)).mount("#app");
```

```vue
<!-- App.vue -->
<script setup lang="ts">
import { useNode } from "vue-dependency-graph/vue";
import { AddToCart, CurrentProductId, DisplayPrice, ProductDetails, runtime } from "./graph";

// Reading a node subscribes to it, which loads it and its dependencies.
const { data: product, status, error } = useNode(ProductDetails);
const { data: price } = useNode(DisplayPrice);

const nextProduct = () => runtime.setContext(CurrentProductId, "prod-2");
const addToCart = () => runtime.mutate(AddToCart, { productId: "prod-1", quantity: 1 });
</script>

<template>
  <p v-if="status === 'loading'">Loading…</p>
  <p v-else-if="error">Couldn't load the product: {{ error.message }}</p>
  <template v-else>
    <h1>{{ product?.name }}</h1>
    <p>{{ price }}</p>
  </template>
  <button @click="nextProduct">Next product</button>
  <button @click="addToCart">Add to cart</button>
</template>
```

Calling `runtime.setContext(CurrentProductId, "prod-2")` invalidates everything downstream of it; whatever is currently subscribed reloads once. Calling `runtime.mutate(AddToCart, ...)` runs the write, and its default `onSuccess` marks the cart stale so it reloads.

### 3. End the runtime's life

A runtime owns timers and in-flight work. The Vue plugin calls `runtime.shutdown()` when the app unmounts. If you create a runtime yourself, call `shutdown()` when its owner ends; after that it rejects new work and aborts anything still pending.

From here, the [user guide](docs/guides/00-user-guide.md) covers failure handling, events, refresh policies and polling, value release, optimistic mutations, transactions, and testing your graph.

## Primary goals

- Make data requirements declarative.
- Automatically load demanded data and its prerequisites.
- Remove manual `loadData()` calls from consumers.
- Allow multiple context changes to commit atomically.
- Support cross-store and cross-team invalidation through typed domain events.
- Preserve useful data while background refresh occurs.
- Provide first-class polling for long-running operations.
- Support independent branch failures without unnecessarily stopping the graph.
- Make execution observable through diagnostics, metrics, snapshots, and devtools.
- Provide strongly typed node definitions and consumer results.
- Keep the core independent of Vue and Pinia.

## Transactions

These examples use the fictional Banksia storefront defined in the [user guide](docs/guides/00-user-guide.md).

Transaction-owned context changes and event publications use the explicit callback handle:

```ts
await runtime.transaction(async (transaction) => {
  transaction.setContext(CurrentProductId, "prod-1");
  transaction.publish(StockChanged, { productId: "prod-1", inStock: true });
  await localWork();
});
```

Plain runtime calls do not join another caller's transaction:

```ts
runtime.setContext(CurrentCurrency, "AUD");
runtime.publish(StockChanged, { productId: "prod-2", inStock: false });
await runtime.refresh([Inventory]);
```

They use committed graph state and proceed independently. If a transaction staged a context before an independent write changed that same context, commit rejects atomically with `GraphTransactionConflictError` and preserves the independent value. Transactions remain local graph transactions and do not roll back remote work.

Each top-level `runtime.transaction(...)` call owns an independent session. To compose work into the same atomic boundary, use the transaction handle explicitly:

```ts
await runtime.transaction(async (transaction) => {
  transaction.setContext(CurrentProductId, "prod-1");
  await transaction.transaction(async (nested) => {
    nested.publish(StockChanged, { productId: "prod-1", inStock: true });
  });
});
```

`runtime.whenSettled()` is scheduler-specific. Await the transaction first, then call `whenSettled()` when commit-triggered scheduler work must finish. An unrelated open transaction does not keep the scheduler unsettled.

## Non-goals

- Replace Pinia as the application's general-purpose client state store.
- Replace HTTP clients or backend SDKs.
- Persist an offline database.
- Implement distributed transactions across backend services.
- Couple one domain store directly to another domain store.
- Publish multiple independently versioned packages: this is one package with one version.

## Documentation

- User guide: [`docs/guides/00-user-guide.md`](docs/guides/00-user-guide.md)
- Public API: [`docs/api/01-public-api.md`](docs/api/01-public-api.md)
- Recipes: [`docs/recipes/`](docs/recipes/)
- Architecture: [`docs/architecture/01-system-overview.md`](docs/architecture/01-system-overview.md)
- Vue and Pinia integration: [`docs/architecture/07-vue-and-pinia-integration.md`](docs/architecture/07-vue-and-pinia-integration.md)
- Architecture decision records: [`docs/decisions/`](docs/decisions/)
- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Test strategy: [`docs/testing/01-test-strategy.md`](docs/testing/01-test-strategy.md)
- Compatibility and release contract: [`docs/maintenance/compatibility.md`](docs/maintenance/compatibility.md)
- Performance measurements: [`docs/maintenance/performance.md`](docs/maintenance/performance.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Staged maintenance record: [`MAINTENANCE.md`](MAINTENANCE.md)

Historical implementation notes preserve point-in-time decisions and validation evidence. Use the documents above for the current architecture and API.

## Development

This repository contains the library (`src/core`, `src/vue`, `src/devtools`), a playground application that exercises it, and the documentation. It is one package; architectural areas are separated by source folders rather than independently versioned workspace packages.

```text
vue-dependency-graph/
├── docs/
├── src/
│   ├── core/          Framework-agnostic graph engine
│   ├── vue/           Vue 3.5 integration
│   ├── devtools/      Optional diagnostics and inspector UI
│   ├── playground/    Playground application source
├── tests/
├── index.html         Playground entry document
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
└── vite.config.ts
```

The logical dependency direction is:

```text
core
  ^
  |
vue

core <--- devtools

core + vue + devtools <--- playground
```

`src/core` must not import Vue or any other project layer. The separation is enforced through folder boundaries, TypeScript configuration, tests, and review rather than separately published packages.

### Technology baseline

- pnpm 12.4.1 for package management
- TypeScript with strict mode
- Vue 3.5
- Vite
- Vitest 4.1.11
- Vue Testing Library for Vue-facing behavioural tests
- ES modules

Dependency versions are pinned in package.json and pnpm-lock.yaml. See the [dependency maintenance policy](docs/maintenance/dependencies.md).

### Bootstrap commands

Use Node 22.13 or newer, enable Corepack, and install the locked dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Run validation:

```bash
pnpm check:boundaries
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage
pnpm build
pnpm check:consumer
pnpm exec playwright install chromium
pnpm check:browser
```

Run the playground or measure graph cascades:

```bash
pnpm dev
pnpm benchmark # requires a current build
```

### Execution responsibility

Run validation locally and in CI. Record commands and outcomes against the actual checkout. If an environment cannot execute a check, report it as pending; static inspection is not a passing test run. API stability (1.0) and npm publication remain gated by the [application migration trial](docs/maintenance/migration-trial.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) before changing the code, and [Releasing a 0.x version](docs/maintenance/compatibility.md#releasing-a-0x-version-github-release) to cut a release.

## License

[MIT](LICENSE)
