# Historical Note: Transaction Notification Buffer

**Status: superseded and removed.**

This note records a pre-Milestone 5 implementation seam. The original runtime notification buffer tracked ambient transaction depth and delayed observer notification, scheduler dispatch, and settlement while any transaction group remained open.

That design is no longer part of the runtime.

Transaction ownership isolation replaced the ambient group with independent `TransactionSession` instances. Context changes and events are staged on the owning session, while observer and scheduler capabilities receive committed work directly. The temporary pass-through compatibility wrapper was removed during the final documentation and cleanup stage.

Current contracts:

- each top-level `runtime.transaction(...)` call creates an independent session;
- same-session composition is explicit through `transaction.transaction(...)`;
- plain runtime operations remain independent while a transaction is open;
- committed transaction effects notify and schedule without waiting for unrelated sessions;
- `runtime.whenSettled()` reports scheduler settlement only;
- generation conflicts reject atomically before predicates or graph mutation;
- diagnostic causality is carried by the owning session's commit context.

Maintained references:

- `docs/decisions/ADR-005-atomic-graph-transactions.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/api/01-public-api.md`
- `docs/implementation/114-transaction-overlap-isolation-plan.md`
