# Recipes (research phase)

These recipes capture coordination patterns that are easy to get wrong when improvising.

They are **not** a complete cookbook and **not** a guarantee of API stability. Prefer the [user guide](../guides/00-user-guide.md), [public API](../api/01-public-api.md), and playground scenarios for day-to-day usage. Use these pages when you hit one of the named failure modes.

| # | Recipe | Failure mode it prevents |
|---|--------|--------------------------|
| 01 | [Atomic cascade on parent context change](./01-atomic-cascade.md) | Stale child data after parent context change |
| 02 | [Optimistic mutation, reconcile, and events](./02-optimistic-mutation-reconcile.md) | Stuck optimistic values or double-applied updates |
| 03 | [Tenancy and auth context checklist](./03-tenancy-auth-context.md) | Silent cross-tenant or permission-incorrect loads |
| 04 | [Stale vs loading under rapid context change](./04-stale-vs-loading-rapid-change.md) | Request storms and confusing loading UX |
| 05 | [Selective event invalidation](./05-selective-event-invalidation.md) | High-frequency events invalidating too much work |
| 06 | [Release when unused](./06-release-when-unused.md) | Retained data after consumers unmount |

## Framing for humans and agents

1. Read the **failure mode** first.
2. Prefer the **minimal correct shape** over inventing a new pattern.
3. Treat anything marked **application policy** as out of scope for the library.
4. Link back to the relevant ADR when behaviour is intentional.

## Status

Research phase. Patterns here reflect the current runtime and playground scenarios. Revisit after the existing-application migration trial if real workflows force different shapes.
