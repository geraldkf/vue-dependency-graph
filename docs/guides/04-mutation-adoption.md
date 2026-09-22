# Mutation Adoption Guide

## Purpose

Use mutations for caller-driven remote commands whose confirmed result may reconcile cached graph data, invalidate authoritative data, publish typed domain events, or temporarily apply optimistic values.

Keep data nodes for reads. A mutation is not another data node, does not participate in dependency execution, is not deduplicated, and does not consume `maxConcurrentLoads`.

## Start with confirmed success only

Prefer the smallest integration first:

```ts
const SaveAppointment = defineMutation({
  key: "appointment.save",
  execute: ({ input, signal }: MutationExecuteContext<SaveAppointmentInput>) =>
    api.saveAppointment(input, signal),
});

const saved = await runtime.mutate(SaveAppointment, input, {
  onSuccess: (effects, result) => {
    effects.update(Appointments, (current) =>
      current.map((item) => (item.id === result.id ? result : item)),
    );
    effects.invalidate([AppointmentSummary]);
    effects.publish(AppointmentBooked, {
      jobSeekerId: result.jobSeekerId,
      appointmentId: result.id,
    });
  },
});
```

Use `update(...)` when the response contains enough authoritative data to update a successful data node immediately. Use `invalidate(...)` when the server remains authoritative or the node has never loaded successfully. Use `publish(...)` for typed cross-domain invalidation already represented by graph event declarations.

For mutation success events, predicates should read direct data or context dependencies whenever those values participate in the same draft. Do not read a derived dependency affected by the mutation's optimistic targets, a direct success update, or explicit invalidation. The derived value has not recomputed during preparation, so the runtime rejects that read instead of evaluating stale data. Unaffected derived dependencies remain valid.

The success callback and all update functions must be synchronous. The runtime validates the complete draft before changing graph state.

Update functions must also be pure. Treat `current` as deeply read-only for application purposes and return a replacement value:

```ts
// Supported
effects.update(Appointments, (current) => [...current, pendingAppointment]);

// Invalid
effects.update(Appointments, (current) => {
  current.push(pendingAppointment);
  return current;
});
```

Development and test builds detect writes through plain arrays and plain objects, including nested plain values, and reject before any local effect commits. Production builds omit this recursive guard for performance. Non-plain values are not guarded, so immutable replacement remains required for `Date`, `Map`, `Set`, class instances, and similar values.

## Add optimistic behaviour only when the user benefit is clear

Optimistic updates require an existing successful value. They must not reinterpret a placeholder `initialValue` as loaded server state.

```ts
await runtime.mutate(BookAppointment, input, {
  optimistic: (effects, originalInput) => {
    effects.update(Appointments, (current) => [
      ...current,
      createPendingAppointment(originalInput),
    ]);
  },
  onSuccess: (effects, saved) => {
    effects.update(Appointments, (current) => replacePendingAppointment(current, saved));
  },
  classifyFailure: (error) => (isKnownRejectedResponse(error) ? "rejected" : "unknown"),
});
```

Only classify a failure as `rejected` when the application has reliable evidence that the server did not commit the command, such as a validation response or explicit business rejection.

A timeout, disconnect, abort, malformed response, classifier failure, or other ambiguous transport condition must be `unknown`. The runtime retains optimistic values as stale and requests authoritative reconciliation instead of displaying a potentially false rollback.

## Idempotency keys

The framework does not generate or persist idempotency keys. Commands that may be retried after an unknown outcome should use a domain-appropriate key generated before the first request and reused for retries of that logical command.

```ts
const input = {
  commandId: applicationCommandId,
  jobSeekerId,
  start,
};
```

The server must define the key scope, retention period, duplicate response, and conflict behaviour. Do not generate a new key for each retry of the same logical action, and do not assume that an HTTP method is automatically idempotent.

## Handling framework errors

### `GraphMutationConflictError`

Another unresolved optimistic mutation owns at least one requested data node. The conflicting request did not start. Disable duplicate submission in the UI or wait for the current attempt to settle.

### `GraphMutationOutcomeUnknownError`

The server outcome is ambiguous. Read `cause` for the original remote failure and `nodeKeys` for affected optimistic state. Tell the user that confirmation is pending, avoid an automatic duplicate command, and allow the scheduled authoritative reload to complete.

### `GraphMutationRollbackConflictError`

A known rejection arrived after newer graph work changed captured state. No old snapshot was restored. Read `cause` for the rejection and `nodeKeys` for conflicts. Preserve the newer values and allow authoritative reconciliation.

A successful known-rejection rollback restores prior logical values and statuses, but it does not restore old generation numbers. Rollback is a new committed transition, so generations continue increasing and obsolete asynchronous work remains obsolete.

If the restored snapshot was already stale and remains subscribed, rollback automatically resumes authoritative graph work through the existing scheduler. Callers do not need to issue a second refresh merely because rollback restored stale state, and `whenSettled()` waits for this recovery work.

Optimistic updates can start subscribed descendant reloads before the command settles. Design loaders and APIs with this timing in mind. A descendant that returns newer changed data before known rejection is preserved rather than overwritten by rollback, and the caller receives `GraphMutationRollbackConflictError`. Mutation execution does not consume a data-load concurrency slot, so a command may begin while descendant loading is queued behind `maxConcurrentLoads`.

### `GraphMutationStateError`

The local effect draft was invalid, such as a never-successful update target or a malformed runtime target. This is an application integration error rather than a remote outcome.

### `GraphMutationReconciliationError`

The remote command succeeded, but local optimistic success reconciliation failed. Do not retry or roll back automatically. Read `mutationKey`, `nodeKeys`, and `cause`, keep any optimistic values presented as stale confirmation-pending state, and allow authoritative reload to settle. `remoteSucceeded` is always `true`. For non-optimistic mutations, local success-effect failures continue to surface as their original errors because there is no optimistic projection to recover.

## Transaction interaction

A plain `runtime.mutate(...)` call remains independent while a graph transaction is open. It cannot see staged context values and is not committed or rolled back by that transaction.

Do not hold a graph transaction open around remote work. Mutation success effects already provide one synchronous local commit after the remote request settles.

## Vue usage

Call the runtime from an application service, store action, or component event handler. Continue to observe graph data through `useNode(...)`, `useNodes(...)`, or `useQuery(...)`.

A generic mutation composable is not required for the current API. Keep application-specific progress labels, form state, and confirmation messages local unless several consumers demonstrate the same lifecycle requirement.
