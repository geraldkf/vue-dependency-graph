# Explainable outcomes: proposed design

Status: proposal; no runtime or devtools behavior has been changed.

Reviewed on 2026-10-11 against `e0dc845`. This extends the structured diagnostic approach in [ADR-014](../decisions/ADR-014-runtime-observability.md) and the public inspector protocol in [ADR-015](../decisions/ADR-015-devtools-inspector-protocol.md).

## Recommendation

Add a deterministic explanation projection over diagnostic snapshots and events. Start in the framework-independent devtools protocol, shared by live and offline viewers. Keep structured facts separate from the text that presents them.

The first release should explain recorded runtime decisions and show current observations. It must distinguish a recorded decision from proof of how the current value was produced. More complete current-value provenance requires additional runtime evidence.

An explanation should answer three separate questions:

1. What can we observe now: value presence, freshness, demand, and policy state?
2. What happened in a selected execution or operation, and which recorded actions caused it?
3. What evidence is missing, so which conclusions cannot be established?

This adds a readable interpretation of the existing diagnostics, rather than a second scheduler, rule evaluator, or state store.

## Existing foundation and concrete limits

| Existing code                               | Useful evidence                                                                                                                | Limitation relevant to explanations                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/diagnostics/types.ts`                 | Event sequence, runtime identity, operation/cause IDs, execution reasons, generations, blocked dependencies, mutation outcomes | Some relationships and transition details are not recorded.                                                                                                              |
| `core/diagnostics/snapshot.ts`              | Current state, declared dependencies, demand counts, refresh timer state                                                       | No value provenance, release timer detail, or runtime lifetime status; snapshot and events do not have a common committed capture marker.                                |
| `core/scheduling/request-tracker.ts`        | Reason and cause of a scheduler flush                                                                                          | Each request replaces the previous reason/cause. Several triggers coalescing into one flush cannot be explained as a complete causal set.                                |
| `core/composition/policy-services.ts`       | Refresh lifecycle events and value-release events                                                                              | Policy callbacks receive fresh operation IDs, separate from the IDs created for their refresh loads. The bridge also omits some available detail, such as policy reason. |
| `core/composition/graph-commit.ts`          | Publications, matched targets, context invalidation                                                                            | Multiple publications produce a combined event key and target union; this does not establish which individual event matched each target.                                 |
| `core/diagnostics/execution-diagnostics.ts` | Load/derive outcomes, reuse, skip, queue, abort/discard                                                                        | Reuse does not identify the original attempt; terminal obsolete events do not state the exact invalidating action.                                                       |
| `core/diagnostics/in-memory-diagnostics.ts` | Bounded history and immutable reads                                                                                            | Eviction and reset remove evidence. A shared collector contains multiple runtimes; aggregate metrics cannot be treated as one runtime's history.                         |
| `devtools/protocol/node-inspector.ts`       | Current detail projection                                                                                                      | Does not receive events or build causal explanations.                                                                                                                    |
| `devtools/composables/devtools-views.ts`    | Shared live/offline view derivation                                                                                            | Suitable integration point for a pure explanation projection.                                                                                                            |

An existing `causeId` is an operation reference, not necessarily an event sequence. Resolve it through an operation index rather than interpreting it as a unique event. An operation may have several lifecycle events.

Generation is a concurrency/invalidation marker, not a unique value identity. A failed refresh can retain an older successful value; an optimistic rollback can restore an earlier value while generations advance. The latest load event is therefore not always the source of the displayed value.

## Banksia Store examples

These are proposed presentation examples, using fictional node keys. Their wording depends on the evidence available.

### Why inventory loaded

> Inventory loaded because the selected store changed. Inventory depends on the selected store, and the product page had demand for inventory.

Evidence should link the recorded context change, affected inventory node, scheduler operation, and load attempt. A topology edge alone proves a declared dependency; it does not prove that this particular change caused this particular attempt.

If a second trigger was coalesced into the same flush and only one attribution was captured, say:

> The scheduler recorded the selected-store change as the trigger. Other coalesced triggers were not fully recorded.

### Why an old value is still visible

> Inventory is stale and still has a successful value. The most recent recorded refresh failed.

Those two facts can be shown separately in the first release. Only say that the displayed value came from a specific earlier attempt when a provenance link establishes it.

### Why checkout did not recompute

> This recorded checkout attempt was blocked by inventory. The inventory attempt in this operation failed.

Use the execution's `blockedBy` evidence and the dependency outcome in the same operation. Do not explain historical blocking using the dependency's current status, which may have recovered since then.

### Why an obsolete response did not change the page

> The inventory attempt was discarded and its result was not applied.

The first release can establish the recorded terminal outcome. A stronger statement such as “discarded because the selected store changed” requires an explicit link to that cancellation/invalidation; event proximity is insufficient.

### Why a mutation remains uncertain

> The stock reservation's remote outcome was unknown. The recorded optimistic inventory update was marked stale for authoritative recovery.

An unknown outcome must remain distinct from rejection. Do not describe it as a successful reservation or a confirmed rollback. Associate effects with the mutation operation and affected node keys, and show subsequent recovery as a separate recorded action.

### Why inventory was released

> Inventory's successful value was released after 30 seconds without demand.

The current release event records elapsed idle time and node identity. Explaining an upcoming deadline, cancellation, or whether the duration came from a node override versus runtime default needs the additional release-policy evidence described below.

## Explanation contract

Proposed initial public function in the `devtools` package:

```ts
computeNodeExplanation({ snapshot, events, nodeKey, operationId? })
```

Keep it a pure function over public diagnostic contracts. It must work without a live runtime or Vue. An optional operation selection explains that recorded operation; otherwise the view shows current observations and the most recent relevant recorded activity, clearly labeled as such.

The structured result should contain:

- `nodeKey` and `runtimeId`.
- Current observations with their snapshot evidence.
- Recorded actions/outcomes with stable codes, such as `execution.blocked`, `execution.discarded`, or `mutation.outcome-unknown`.
- Relationships explicitly supported by operation/cause IDs and affected keys.
- Evidence references: runtime-local event sequences, operation IDs, node keys, and snapshot fields.
- Missing evidence codes: `history-unavailable`, `history-evicted`, `history-reset-or-gap`, `cause-not-retained`, `ambiguous-attempt`, `coalesced-causes-unavailable`, or `snapshot-correlation-unavailable`.
- The retained sequence range used for the explanation.

Assess completeness per claim or causal branch, rather than attaching one confidence percentage to the entire explanation. Missing history does not make a current snapshot's demand count unknown. A known recorded failure does not establish that it caused the current state.

Expose machine-readable reason codes and evidence first. Generate deterministic English labels from them in a formatter; applications can localize or supply domain labels. Store neither generated prose nor duplicated values in the collector.

The proposed function is illustrative API design, not an implemented export. Final TypeScript unions should be narrowed around the first supported explanation cases before implementation.

## Derivation algorithm

1. Filter events by `snapshot.runtimeId`. Do not merge operations across runtimes, even if node keys are identical.
2. Build indexes by operation, cause, node/affected key, and sequence for one captured event window. Build once per view revision and reuse when selection changes.
3. Extract current observations directly from the snapshot, without guessing their origins.
4. Select the requested operation or relevant recorded activity for the node. Keep successful commits, failed attempts, invalidations, and optimistic effects as distinct facets.
5. Follow only explicit causal relationships. A dependency's declared topology can provide context but is not automatically an execution or value-provenance edge.
6. Return facts and missing links together. A missing root should leave a visible partial chain, not be replaced with a plausible narrative.
7. Format the facts for display, with links to evidence in the timeline or dependency inspector.

Bound chain depth and output size; detect cycles and report truncation. For a diagnostic history of E events, N nodes, and L relevant relationships, index construction should be O(E + N), with selected-node traversal bounded by the retained relationships and configured limits. Avoid scanning the entire history separately for every displayed node.

Diagnostic sequence is authoritative for event ordering. Do not infer causality from equal timestamps or elapsed time. The configurable diagnostics clock and timer environment can differ, and normalization changes time values. Countdown displays must use explicit timer snapshot data, not subtract unrelated clocks.

## Devtools experience

Add a “Why?” section to the existing node inspector:

- **Current observations:** stale/fresh, successful value present, demand, and available policy state.
- **Latest recorded activity:** an outcome summary with a selectable operation.
- **Recorded cause chain:** expandable actions and dependencies, each linked to timeline evidence.
- **Evidence limits:** specific missing links or evicted history, next to the affected claim.

Selecting an earlier operation should keep its historical explanation separate from current node facts. Expanding a cause can select its context node, dependency, or operation in the existing inspector/timeline.

Live and offline modes use the same protocol and formatter. Export raw snapshot/event evidence and recompute the presentation on import. A normalized test export should preserve explanation structure, although absolute time labels will differ.

Old exports remain useful: produce the subset of facts their schema supports and mark unavailable relationships. Do not silently fabricate fields when loading them.

## Instrumentation needed for stronger explanations

### A. Multiple scheduling causes

Preserve a bounded, deduplicated set of pending scheduling causes with target node keys. A flush can have several causes, and a cause affecting one branch must not be attributed to every node executed by that flush. Keep the current scalar reason as a primary label for compatibility, with explicit overflow metadata if the set is capped.

Move only diagnostic attribution into this richer tracker; scheduling behavior and coalescing remain unchanged. Attempts within a later in-flight flush require their own causal records rather than consuming the next flush's pending causes accidentally.

### B. Attempt identity and cancellation reasons

Give each attempted load/derivation a diagnostic attempt ID. Include it on start, completion, queue, and terminal obsolete events. A reuse event points to the reused attempt ID, while its own requesting operation remains distinct.

Capture a typed cancellation/discard reason at the action that makes work obsolete: superseding invalidation, final automatic-demand removal, or terminal shutdown. Pass it through to the terminal outcome without changing ownership or abort behavior. If several actions race, define a deterministic first-recorded reason and preserve subsequent causes as secondary evidence where useful.

Do not interpret all aborts as unsubscribe, or all discarded loads as context changes.

### C. Policy lifecycle links and release state

Introduce a policy session ID and a per-fire operation link, connecting schedule/retry, timer firing, initiated refresh, and outcome. Preserve typed completion/failure/timeout/stop reasons rather than dropping them in the composition bridge.

Expose effective release configuration and timer state in diagnostics: policy source (`node` or `runtime-default`), retain/no-policy distinctions, duration, generation, armed deadline or remaining duration, and cancellation/rearm reason. Record successful release with its resulting state revision. Represent unbounded retention explicitly rather than serializing `Infinity` as a JSON number.

Include terminal runtime lifetime and background-policy enabled/stopped status so “no timer” can be explained as a current fact. Policy disposal and terminal shutdown must remain distinct.

### D. Per-event matching

Record each publication's matched node keys under the commit operation. Preserve publication order and transaction ownership. Keep aggregate invalidation deduplicated; explanatory detail must not repeat execution or reevaluate predicates.

Do not split the current combined `eventKey` string to recover mappings. An event key can contain punctuation, and the union of targets does not reveal individual matches.

### E. Current-value provenance and capture consistency

For authoritative “why this current value?” support, carry a diagnostic-only state revision and value-origin reference through committed changes. Existing load/derive success events, context commits, mutation effects, rollback/reconciliation, and release must expose the affected revisions. A retained value carries its prior origin even when status/freshness changes. A rollback restores the prior origin while recording the rollback action separately.

Capture these references at actual commit boundaries. A requested or started operation is not proof that its value was applied. Initial values have an explicit initial origin; missing earlier evidence remains missing.

A snapshot/export also needs a capture revision/event watermark and collector-window metadata, including reset epoch and retained sequence ranges per runtime. A watermark alone does not make separately read events and state atomic: synchronous listeners, redactors, or collector callbacks can reenter the runtime. Capture copied structural state/evidence coherently, check revisions around capture, and use a bounded retry or explicit inconsistent-capture marker when reentry intervenes. Never wait for settlement to produce an explanation.

This is a later phase because it touches all commit families. The first release must not promise current-value provenance from the existing V1 event window.

## Compatibility, retention, and operational behavior

- Keep explanation indexing and formatting outside runtime scheduling and outside `whenSettled()`.
- With no diagnostic sink, retain no causal index or explanatory history. State observations may still be available; historical explanations are unavailable.
- Store IDs, keys, safe reason codes, revisions, and bounded dependency lists. Do not retain payloads, mutation inputs/results, closures, or graph values for explanation purposes.
- Preserve value omission/redaction. Explanation labels must not reintroduce omitted values through interpolation. Existing error messages remain subject to the diagnostic export's existing exposure policy.
- Treat the event window as bounded. An explanation of a node unchanged for a long time can be partial even if its current state is fully known. Do not add an implicit unbounded archive.
- Keep observation failure isolation: a failing collector, renderer, or formatter cannot change runtime results. Protocol failure should surface as a view error rather than mutate the runtime.
- Older V1 exports support the conservative initial projection. Additive optional metadata can retain V1 compatibility where its semantics are unchanged. Use a new schema version for required causal/provenance guarantees or changed event meaning, updating readers, exports, normalizers, and golden traces together.
- Benchmark enabled diagnostics and the explanation view separately. Avoid adding per-node history scans to the incremental release reconciliation path.

## Testing and acceptance criteria

Use Banksia fixtures with deferred work and deterministic clocks. Assert reason codes and evidence relationships; reserve a small set of wording checks for the formatter.

Required scenarios:

1. Selected-store change invalidates inventory and causes a demanded reload.
2. Subscription and context change coalesce; both recorded causes stay attached to their actual targets once richer attribution exists.
3. A fresh skip and shared-attempt reuse remain different explanations; reuse identifies the original attempt once IDs exist.
4. A dependency fails, checkout is blocked, then inventory recovers; the historical blocked explanation remains accurate.
5. An obsolete response arrives after a newer attempt succeeds; it cannot become the displayed value's provenance.
6. A refresh fails while an older successful value remains visible.
7. Mutation rejection, unknown outcome, and local reconciliation failure produce distinct facts and recovery chains.
8. Retry/pause/resume and release/resubscribe expose their recorded decisions without extra requests or timers.
9. Eviction, reset, missing parents, diagnostic sink failure, and diagnostics-disabled mode produce explicit evidence limits.
10. A shared collector and two runtimes with identical node keys never mix causal chains.
11. Live, exported, imported, and normalized evidence produces equivalent structured explanations for supported facts.
12. Explanations do not expose omitted values, retain released objects, emit events, or change notification/request counts.
13. Reentrant capture does not present mismatched state and event evidence as an authoritative current-value explanation.

For causality tests, removing a required link should change the result to partial evidence, not leave the same complete sentence passing. This guards against explanations that are plausible but unsupported.

## Delivery plan

1. **Conservative explanation protocol and inspector UI.** Use existing V1 events for blocked/failed/skipped/discarded executions, invalidations, mutation outcomes, and current observations. Support operation selection, evidence links, partial-history messages, and offline parity.
2. **Precise causal attribution.** Add bounded multi-cause scheduling, attempt/reuse IDs, policy links, per-publication matches, cancellation reasons, and release/lifetime detail. Update diagnostics compatibility tests and benchmarks alongside each change.
3. **Authoritative current-value provenance.** Add commit references and consistent capture metadata across load, derived, context, transaction, mutation, rollback, and release paths. Extend exports deliberately.
4. **Optional business explanations.** If needed, design a separate application annotation contract for decisions such as free-delivery eligibility. Runtime causality alone cannot explain the business branch inside an arbitrary `derive` or `load` function.

The first phase is immediately useful and fits the current architecture. The second removes known attribution blind spots. The third provides the stronger guarantee that the explanation belongs to the value currently displayed, rather than merely the latest recorded activity.
