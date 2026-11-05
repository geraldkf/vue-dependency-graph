# Documentation

New to this library? Start with the [User guide](./guides/00-user-guide.md) - a narrative walkthrough built around one running example. Everything below is reference material for once you're past the basics.

The architecture pages and decision records use the same fictional Banksia storefront as the user guide. Shared example names are `CurrentProductId`, `ProductDetails`, `CurrentCurrency`, `DisplayPrice`, `Inventory`, `StockChanged`, `ProductPage`, `OrderStatus`, `Cart`, and `AddToCart`. Node definitions, domain types, and application API helpers come from the guide; individual reference snippets show the part relevant to that topic. Playground and test walkthroughs describe the scenario names actually implemented in this repository.

Use these maintained documents as the current sources of truth:

- [User guide](./guides/00-user-guide.md)
- [UI, Pinia, and the dependency graph](./guides/01-ui-and-pinia-graph.md) — department default: Pinia owns the runtime; component roles; status UI; multi-panel `useNodes` / `isSuccess`; migration checklist
- [Public API](./api/01-public-api.md)
- **Architecture**
  - [System overview](./architecture/01-system-overview.md)
  - [Graph and node model](./architecture/02-graph-and-node-model.md)
  - [Scheduler, transactions, and concurrency](./architecture/03-scheduler-transactions-and-concurrency.md)
  - [Events, refresh policies, and polling](./architecture/04-events-refresh-and-polling.md)
  - [Mutations, failures, and cache](./architecture/05-mutations-failures-and-cache.md)
  - [Observability, devtools, and snapshots](./architecture/06-observability-devtools-and-snapshots.md)
  - [Vue and Pinia integration](./architecture/07-vue-and-pinia-integration.md)
- [Architecture decision records](./decisions/)
- [Recipes](./recipes/) — short patterns for cascades, optimistic mutations, tenancy, stale UI, events, release, Pinia runtime ownership, multi-node panel `isSuccess`, and long-running `pollUntil` operations
- [Test strategy](./testing/01-test-strategy.md)
- [Roadmap](./ROADMAP.md)
- [Playground](./PLAYGROUND.md)
- [Compatibility and release contract](./maintenance/compatibility.md)
- [Dependency maintenance](./maintenance/dependencies.md)
- [Performance baseline](./maintenance/performance.md)
- [Bounded application migration trial](./maintenance/migration-trial.md)
