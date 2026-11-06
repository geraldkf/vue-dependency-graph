# ADR-022: Per-node change notification, incremental refresh reconciliation, and a demand index

## Status

Accepted, implemented, and validated.

## Context

The runtime emits one global change signal. Three consumers did work proportional to the size of the graph, or to the number of their peers, on every one of those signals:

- **Refresh policies.** Every notification reconciled every node with a refresh policy. Release policies had already been made incremental (see the performance record); refresh policies had not, and the benchmark had no refresh policies, so the cost was never measured. With a `staleAfter` policy on every node, one context change in a 2,000-node graph took about 6.3 seconds.
- **Vue composables.** Each mounted `useNode` / `useNodes` registered a global `onChange` listener that re-read its node's state on every notification, in a graph of any size. The cost is the number of mounted composables times the number of notifications, so mounting 2,000 components spent about 2 seconds of CPU on initial load.
- **Scheduler flushes.** Every flush scanned every node in the graph to find the directly subscribed ones.

A fourth problem was a bug rather than a cost: `shutdown()` built its removal lists with `push(...Array(n))`, which throws a `RangeError` once one node has on the order of a hundred thousand subscriptions.

## Decision

**Refresh reconciliation is incremental.** The refresh controller registers its policy nodes with a change tracker, exactly as the release controller does, and reconciles only the nodes whose state or subscription demand changed. A full pass still happens when the timer environment resumes from a pause. The change tracker now supports several independent consumers per state, because release policies, refresh policies and node listeners can all watch the same node.

**`runtime.onNodeChange(node, listener)` is added.** The listener runs only when that node's own runtime state changed. Notification order is: global `onChange` listeners first, then node listeners, once per notification. A node is tracked only while it has a listener, so the mechanism costs nothing when unused, and a notification costs time proportional to the nodes that changed. Listener failures are isolated and reported as `runtime.listener-failed`, as for global listeners. `onChange` is unchanged and remains the right tool for anything that is not about one node, including subscription counts, which are not node state.

**The Vue composables use `onNodeChange`.** `useNode` listens to its one node. `useNodes` listens to each of its nodes and replaces only the entry that changed, so unaffected results keep their identity. Both re-sync once after registering, because a node listener only hears about changes made after it registered, whereas the global signal used to repair any earlier miss on the next notification.

**The subscription controller keeps an index of directly subscribed nodes**, updated as direct counts move between zero and non-zero. Flushes select targets from it, in graph declaration order, so target order is exactly what it was.

**`shutdown()` builds its removal lists with plain loops.**

## Consequences

`GraphRuntime` gains one method. This is additive; no existing call changes behavior. Anything that implements `GraphRuntime` itself (a test double, for example) needs the new member.

Observed behavior of the Vue composables is unchanged: the same fields drive the same updates, through the same `statesEqual` filter. What changes is how often the filter has to run.

The cost of a notification now scales with what changed and what is demanded rather than with graph size or mounted-component count, for these three paths. Other global consumers (the two policy reconcilers' keyed lookups, devtools, application `onChange` listeners) are unchanged.

Because node listeners run after global listeners, a global listener that wants to see node listeners' effects must not assume they have already run.

## Validation

`tests/core/change-tracker.spec.ts`, `node-observer.spec.ts`, `refresh-policy-incremental.spec.ts` and `subscription-demand-index.spec.ts`, and `tests/vue/node-notifications.spec.ts`. The node-observer suite includes an equivalence test that mirrors every node through node listeners across context changes, transactions, refreshes and demand changes and asserts the mirror equals `getState` after each step. Faults injected into the observer dispatch, the demand index, the multi-consumer tracker, the refresh key filter, the Vue listener choice and the Vue catch-up sync each fail the suite.

The benchmark gained `--refresh=on`, `--observe=node` and `--observers=N`, and its existing correctness assertions (exact loads and derivations, no loading of undemanded nodes, zero demand after shutdown) hold in every mode. Before and after results are in [performance.md](../maintenance/performance.md).

## Alternatives considered

**Reference-stable cached snapshots only.** Measured as a prototype: about 1.4 times faster, because the listener calls themselves still happen. It also required state records to carry a cache that every transition must clear, outside the transition module's current ownership rules. Not adopted.

**Changing `onChange` to carry the changed keys.** Would change an existing signature that applications use. Rejected in favor of an additive method.

**Reconciling refresh policies from the release controller's tracker.** The two policies have different eligibility sets and different reconcile rules; sharing one pending set would couple them. Separate trackers cost one set each.
