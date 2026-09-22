# ADR-004: Subscription-Driven Loading

## Status

Accepted, implemented, and validated.

## Context

The service this framework replaces required each consumer to call an explicit `loadData()`-style method before a node's value was populated, in addition to declaring the node and its dependencies. Declaration and activation were two separate steps a consumer had to remember to perform together, in the right order, and to repeat correctly on every code path that might render the data.

An alternative considered at the outset was eager execution: run every registered node's loader as soon as the graph is created. This avoids the missing-`loadData()` class of bug, but does so by loading data nobody has asked for yet, which is wasteful for graphs where only a subset of nodes are relevant to any one screen, and gives a component no way to express "I no longer need this" once mounted.

## Decision

Graph registration (`createGraph(...)`) never executes anything. A `GraphRuntime` only executes a node when one of the following requests it:

- a node subscription (`runtime.subscribeNodes([...])`) marks the node, or a required ancestor of it, as needing to stay fresh - this is what a mounted Vue component does through `useNode`/`useNodes`/`useQuery`;
- a caller-owned operation explicitly requests it (`execute(...)`, `prefetch(...)`, `refresh(...)`);
- an active refresh policy's timer fires.

Creating a subscription is synchronous and does not invoke loaders synchronously; a non-empty subscription instead requests one coalesced scheduler microtask, which then determines which subscribed nodes are not fresh and executes exactly those (plus their required ancestors). There is no separate, manually-called activation step.

## Consequences

- A component that mounts and calls `useNode(Targets)` loads `Targets` (and any ancestors it needs) automatically; there is no public `loadData()` call for a consumer to forget. Unmounting releases the subscription, and the final unsubscribe stops automatic work that only that subscription owned.
- The scheduler must coalesce synchronous subscription changes into one microtask pass rather than executing per individual `subscribeNodes` call, or mounting several components in the same tick would each trigger a redundant separate execution pass.
- A node with no current subscriber, and not targeted by an explicit `execute`/`prefetch`/`refresh` call, simply never runs - there is no background execution of unused parts of the graph.
- A failed subscribed node does not enter an automatic retry loop; recovery requires an explicit trigger (a context change, a new subscription, or a refresh policy), which keeps failure handling predictable rather than silently hammering a broken endpoint.

## Alternatives considered

### Eager execution at graph creation

Rejected. Runs loaders for data no consumer has requested yet, and provides no natural point at which to stop - "the graph exists" is not the same lifecycle event as "a consumer needs this value."

### Manual imperative activation (`node.loadData()`)

Rejected as the primary model. This is the exact per-node, easy-to-forget boilerplate that motivated building a standalone framework in the first place (see ADR-001). Retaining it as the only trigger would not meaningfully improve on the prior service.
