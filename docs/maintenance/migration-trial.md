# Bounded application migration trial

This is a trial plan, not evidence that an external application was migrated. The current repository provides a deterministic playground and a real-browser smoke suite; neither substitutes for the application's backend and existing behavior.

## Select and baseline

Choose one existing workflow with multiple dependencies, existing behavioral coverage, low operational risk, and clear request expectations. Record its repository/revision, entry route, runtime owner, API requests, loading order, time to useful data, cancellation behavior, and current error/stale-data behavior.

Inventory context roots (including tenant/auth identity), data and derived values, mutations, invalidation events, polling, reference caches, and unmount ownership. Start with one coherent graph rather than moving every store.

## Implement and compare

Keep the old implementation behind an application-owned feature flag. Introduce graph nodes with scoped context dependencies and immutable mutation updaters. Pass AbortSignal to the HTTP client. Own the runtime in one store/app; keep node state out of mirrored Pinia refs.

Measure before and after under the same backend responses and latency:

| Case                                      | Required evidence                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Initial load and concurrent consumers     | Request counts, dependency order, useful-data timing                           |
| Rapid selection and tenant/auth changes   | No late result commits into another context; intentional stale-data visibility |
| Initial/refresh failure and retry         | Error display, retained values, bounded retry                                  |
| Mutation finishes after selection changes | Remote outcome distinguished from local reconciliation; new entity preserved   |
| Poll completion/failure then a new job    | New polling cycle starts and stops correctly                                   |
| Navigation/unmount/owner teardown         | Demand counts, stopped timers, aborted work, handled shutdown rejection        |
| Large values/reference data               | Appropriate release duration/Infinity and measured memory behavior             |

Use diagnostic traces to explain loading and recovery. Check the real workflow in its supported browsers. Record deviations explicitly instead of assuming behavioral equivalence.

## Rollback and exit

Disable the feature flag, shut down the graph runtime, and restore the old ownership/loading path. Confirm there are no concurrent old/new loaders and that remote writes are never blindly replayed because local reconciliation failed.

The exit report must identify the exact revisions, measured results, compatibility gaps, remaining risks, rollback exercise, and a recommendation to adopt, revise, or stop. A trial cannot be marked complete until a real application workflow supplies this evidence.
