## ADR-012: Subscription-Aware Refresh Policies and Polling

### Status

Accepted and implemented in Milestone 8. Full automated validation and the Polling Progress manual browser paths passed.

### Context

The runtime supports subscription-driven loading, explicit refresh, cancellation, stale-data retention, generation protection, shared attempts, a runtime-wide concurrency limit, time-based freshness, and polling for long-running resources.

Polling implemented inside a node loader would require recursive delays, hide request ownership, bypass normal refresh preparation, complicate cancellation, and make deterministic testing difficult. Browser lifecycle imports in the core would also violate the framework boundary.

### Decision

Add immutable refresh-policy metadata to data-node definitions and interpret it through one runtime-local policy controller.

The first release supports one policy per data node:

- stale after a duration;
- fixed interval while subscribed;
- poll until a typed completion or failure condition.

Policy work runs only while the node has subscription ownership. It delegates loading to the existing refresh and execution machinery with a distinct automatic execution origin. It uses recursive timeouts rather than intervals, supports bounded retry with fixed or exponential backoff and jitter, and accepts an injected environment for clocks, randomness, and pause/resume state.

Poll timeout is based on active elapsed time and excludes paused duration. Terminal polling and retry errors preserve the latest successful data and use the existing stale/error state model.

The core does not import browser APIs. Optional Vue/browser integration provides environment signals for document visibility and network availability.

### Consequences

- No second execution or cache path is introduced.
- Existing concurrency, cancellation, deduplication, generation, and stale-data rules remain authoritative.
- Runtime instances own independent timers and policy sessions even when they share one graph definition.
- Final unsubscribe clears timers and may abort automatic-only work.
- Manual refresh remains caller-owned and does not inherit policy retry behaviour.
- `whenSettled()` remains scheduler-specific because interval policies may never become permanently idle.
- Deterministic tests require an injected fake clock and random source.
- Structured policy diagnostics remain deferred to Milestone 10.

### Alternatives considered

#### Poll recursively inside `load(...)`

Rejected. It would hold one execution attempt across multiple requests, hide progress commits, bypass normal refresh semantics, and make cancellation and concurrency accounting misleading.

#### Use `setInterval(...)`

Rejected. A new tick can occur while the prior request is active. Recursive timeout scheduling after settlement guarantees non-overlap.

#### Run policies without subscribers

Rejected for the first release. Background activity without a consumer creates unclear lifetime and resource ownership. An explicit always-on mode can be added later if a concrete application requires it.

#### Add browser lifecycle logic to core

Rejected. The core remains usable outside Vue and outside browsers. Lifecycle signals enter through an injected environment.

#### Broaden `whenSettled()` to include policy timers

Rejected. A fixed interval may intentionally remain active for the lifetime of a subscription, making global settlement non-terminating. Deterministic policy testing should control time explicitly.

#### Support multiple policies per node

Deferred. Composition requires precedence rules for timers, retries, pause state, and terminal outcomes. One policy covers the current milestone use cases with a smaller public contract.

### Detailed plan

See `docs/implementation/78-milestone-8-refresh-polling-plan.md`.
