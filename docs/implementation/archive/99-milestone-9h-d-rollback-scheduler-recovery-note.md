# Milestone 9H-D: Rollback Scheduler Recovery

## Status

Implemented. Offline validation pending.

## Scope

M9H-D ensures that safe known-rejection rollback resumes normal graph work when it restores stale subscribed state. It reuses the existing subscription query and scheduler rather than introducing mutation-specific loading.

## Implemented behaviour

The mutation controller now receives the runtime's existing `hasSubscribers(node)` capability.

After rollback validates ownership and generations, restores all logical snapshot fields, advances generations, and aborts obsolete work, it checks the complete captured snapshot set. It requests one scheduler pass when at least one restored snapshot:

- had `freshness: "stale"`; and
- currently has a direct or required subscriber.

Ownership is released before observers and scheduler work proceed. Rollback still emits one atomic state notification.

## No scheduling cases

Rollback does not request work when:

- every restored snapshot was fresh;
- stale restored snapshots are unsubscribed;
- optimistic preparation produced no effective change and therefore no session;
- rollback validation fails, because rollback-conflict reconciliation already owns its scheduling decision.

## Scheduler interaction

The recovery request uses the existing scheduler. It therefore preserves:

- target deduplication;
- dependency ordering;
- normal data-load concurrency limits;
- derived recomputation rules;
- active-attempt and generation protection;
- `whenSettled()` semantics.

Multiple restored stale nodes, including shared ancestor and descendant paths, produce one scheduler request rather than one request per snapshot.

## Behavioural coverage

Focused tests cover:

- one stale subscribed snapshot starting authoritative recovery;
- one fresh subscribed snapshot producing no extra load;
- one stale unsubscribed snapshot producing no extra load;
- multiple stale subscribed targets coalescing into one scheduler transition;
- a shared stale parent and derived child recovering in one graph pass;
- `whenSettled()` remaining pending until rollback-triggered recovery finishes;
- obsolete pre-optimistic refresh results remaining unable to overwrite recovery data.

## Compatibility

The public runtime and mutation APIs are unchanged. The mutation controller receives one additional internal dependency already owned by the subscription controller.

Applications observing stale subscribed state after rollback now receive the same automatic recovery behaviour as other invalidation paths.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
- Core boundary validation passed.
- Static documentation and ZIP integrity checks are completed when the cumulative package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9H-D remains validation pending until all four commands succeed against the combined checkout.

## Next task

Implement M9H-E immediate optimistic descendant loading coverage, confirming the selected pre-settlement data-descendant behaviour and its generation-conflict protections.
