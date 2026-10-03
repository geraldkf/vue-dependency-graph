# ADR-008: Branch-Scoped Failure Handling

## Status

Accepted, implemented, and validated.

## Context

A single `runtime.execute([...])` or subscription-driven scheduler pass can involve many independent dependency branches - for example, a page that needs both `ProductDetails` (depending on a flaky product-catalogue service) and `Inventory` (depending on an unrelated, healthy service). If one branch's dependency fails, a fail-fast model that rejects the whole call on the first error would prevent `Inventory` from ever settling, even though nothing about it depends on the failing service. That would make one broken, unrelated data source able to blank out an entire page.

The failure also needs to be attributable to a specific node rather than reported as one generic "something failed" state, both so a UI can show which piece of data is actually unavailable and so a descendant that required the failed node can be distinguished from one that failed on its own account.

## Decision

Failure is evaluated per dependency branch, not globally for the call:

- A node whose own load or derive throws (and is not superseded or aborted) records a `failed` entry with its error.
- A node that required a failed (or itself-blocked) ancestor does not execute and records a distinct `blocked` entry naming which ancestor(s) blocked it.
- A node with no dependency on the failure executes and settles normally, independent of the rest of the call.
- Once every executable branch of the call has settled, the caller's promise rejects with one `GraphExecutionError` aggregating every `failed` and `blocked` entry from that call. Per-node runtime state remains independently readable regardless of how the aggregate call settled. `GraphExecutionError` distinguishes nodes that failed directly from requested nodes that were blocked by failed dependencies.

Obsolete and aborted attempts (superseded by a newer generation, or cancelled because no subscriber needs them any more) are not business failures under this model and are not recorded as `failed` or `blocked` entries at all.

## Consequences

- One `execute([ProductDetails, Inventory])` call where `ProductDetails` fails still resolves `Inventory` successfully; the caller only learns about the `ProductDetails` failure through the aggregated `GraphExecutionError`, not by every unrelated node also failing.
- The execution engine must track outcomes per node across the whole traversal rather than short-circuiting the call on the first thrown error - a diamond-shaped dependency with two children of one failing parent must record both children as `blocked`, not just the first one reached.
- Automatic (subscription-driven) failures are captured in `SchedulerState.error` without becoming an unhandled promise rejection, and do not trigger an automatic retry loop; only an explicit trigger (context change, new subscription, refresh) starts a new attempt.
- `blockedBy` distinguishes "this node itself failed" from "this node was prevented from running by something upstream," which a single flat error list would not.

## Alternatives considered

### Fail-fast: reject the whole call on the first node failure

Rejected. Would abandon unrelated, otherwise-successful branches for no reason connected to them, making the blast radius of one failing dependency the entire requested set rather than just its own descendants.

### One aggregate error/status for the whole call, without per-node attribution

Rejected. Loses which specific node(s) actually failed versus were merely blocked by something upstream, which a consumer needs in order to render a specific, actionable error rather than a generic "something went wrong."
