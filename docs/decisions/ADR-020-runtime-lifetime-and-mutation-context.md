# ADR-020: Runtime lifetime and mutation context

## Decision

Keep `dispose()` as the existing policy-only operation and expose the clearer alias `stopBackgroundPolicies()`. Add terminal, idempotent `shutdown()` for an owner ending a runtime's lifetime. Vue plugin app unmount and the playground's Pinia owner use shutdown; shared runtimes opt out through `disposeOnUnmount: false`.

Shutdown stops policies, prevents new work, clears runtime listeners and demand counts, aborts active and queued loaders, and stops waiting for non-cooperative mutation and transaction work. Inspection remains available. It cannot undo remote side effects or stop application code that ignores cancellation. Pending mutation/transaction promises reject with `GraphRuntimeShutdownError`; no late graph value commits occur. Scheduler settlement remains scheduler-specific.

Mutation calls capture context generations before remote work. Every direct success-update target validates its transitive context ancestors before applying a draft. A changed context rejects the complete draft with `GraphMutationReconciliationError` and `remoteSucceeded: true`. Optimistic ownership is released and recovery preserves current values. Same-context refreshes and unrelated contexts remain compatible. Switching away and back still counts as a changed context; this is conservative by design. Event-only or invalidation-only success effects remain application-scoped through their payloads and predicates.

Terminal polling state belongs to its generation. External invalidation or explicit refresh starts a new session; policy-owned retries preserve their current generation on exhaustion.

## Consequences

Optimistic drafts also check their target contexts before preparation and commit. If selection changes before the remote request starts, the draft rejects with `GraphMutationConflictError` and the request is not sent. Shutdown inside a caller callback or updater is checked again before committing graph changes.

The private API gains two lifecycle methods and one public runtime error. `dispose()` callers retain their existing behavior. Owner teardown now permanently ends the runtime and integrations must handle pending-operation rejection. Mutation results represent remote success even when local reconciliation rejects; callers must not blindly repeat the command.

Runtime shutdown retains the final state for diagnosis. Dropping the runtime reference is still necessary to release its final cached values. Diagnostic collectors have independent ownership and subscriptions; shutdown clears runtime observers, while devtools scope cleanup removes its collector subscription.

## Validation

Public API tests cover context switching with and without optimistic effects, transitive dependencies, same-context refresh, unrelated context changes, whole-draft rejection, terminal polling restart, queued work, ignored aborts, staged transactions, and reentrant shutdown. Existing golden traces remain unchanged.
