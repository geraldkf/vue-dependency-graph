# TOI-8E Maintained Documentation Reconciliation Note

## Status

Prepared. Documentation review and final validation pending.

## Reconciled maintained documents

- `README.md` now introduces explicit transaction ownership and conflict behaviour.
- `docs/api/01-public-api.md` documents the narrow handle, lifecycle, immediate runtime methods, conflict error, and settlement order.
- `docs/architecture/03-scheduler-transactions-and-concurrency.md` documents ownership, dispatch separation, lifecycle, conflicts, settlement, and joined overlap.
- `docs/architecture/04-events-refresh-and-polling.md` documents staged versus immediate event publication.
- ADR-005 and ADR-006 point to the maintained contract and migration guidance.
- `docs/README.md` indexes TOI planning, implementation, playground, coverage, and migration documents.
- `docs/PLAYGROUND.md` provides deterministic context isolation, conflict, and event isolation walkthroughs.
- `docs/implementation/67-toi-8e-migration-guidance.md` gives required source migration patterns and a repository checklist.
- The roadmap marks TOI-8E prepared and leaves TOI-8F final validation open.

## Historical documents

Milestone 5 and Milestone 6 implementation notes remain historical point-in-time records. They are not rewritten to imply that explicit transaction ownership existed originally. Maintained public API, architecture, ADR amendments, playground documentation, and migration guidance supersede their old ambient examples.

## Final remaining work

TOI-8F must run the full boundary, type, test, build, and manual playground validation matrix and record the result.
