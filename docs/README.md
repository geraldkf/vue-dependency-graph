# Documentation

New to this library? Start with the [User guide](./guides/00-user-guide.md) - a narrative walkthrough built around one running example. Everything below is reference material for once you're past the basics.

Use these maintained documents as the current sources of truth:

- [User guide](./guides/00-user-guide.md)
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
- [Test strategy](./testing/01-test-strategy.md)
- [Mutation adoption guide](./guides/04-mutation-adoption.md)
- [Roadmap](./ROADMAP.md)
- [Playground](./PLAYGROUND.md)

For the per-milestone build history (plans, implementation notes, validation
handoffs) that produced the above, see
[`implementation/README.md`](./implementation/README.md). It's a historical
record, not something to read to understand the system as it stands today -
start with Architecture above for that.
