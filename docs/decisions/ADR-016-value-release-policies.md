# ADR-016: Automatic Value Release Through Timer-Based Release Policies

## Status

Accepted, implemented, and validated.

**Amended:** the authoring syntax shown in the Decision section below (`releaseAfter({ durationMs })` and `retain()`) was later simplified, before any external consumers existed. A node's `release` option is now a plain number of milliseconds - the same shape as the runtime's own `releaseAfterMs` default - with `Infinity` replacing `retain()` as the explicit opt-out. The mechanics, resolution order, and everything else this ADR decides are unchanged; only the surface syntax for expressing the same two cases moved. The original examples below are preserved as the record of the original decision. See the [user guide](../guides/00-user-guide.md#10-releasing-idle-data) for current usage.

## Context

`state.ts` seeds one runtime-state slot per node from the graph's static topology at `createGraphRuntime` time and never deletes an entry. Nothing currently clears a node's held value under any condition:

- Losing the last subscriber only aborts an in-flight _automatic-only_ execution attempt (`afterUnsubscribe` in `runtime.ts`); a value that already finished loading is untouched.
- A context change or event invalidation only sets `freshness = "stale"` (`invalidateNodes` in `invalidation.ts`); this is deliberate - [ADR-007](./ADR-007-status-freshness-separation.md) keeps stale-but-useful data visible rather than flashing blank - but it means old data is never cleared, only marked for eventual replacement.

The only thing that ever replaces a value is a successful re-execution actually completing. A node that loses its last subscriber and is never asked for again keeps its value in memory for the runtime's entire lifetime.

This is a narrower problem than it first appears from surveying other caching libraries. TanStack Query, Apollo Client, Relay, and SWR all cache one entry per distinct query-key/variables combination, so their primary concern is bounding the _number of entries_. This framework's node slots are fixed at graph-creation time from static `defineXNode` declarations and never grow in number - there is no "entry count" problem here. The actual gap is narrower and specific: a fixed, known set of node slots, any of which can hold an arbitrarily large value that nothing ever releases.

## Decision

A per-node, timer-based release policy, with a runtime-level default:

```ts
import { releaseAfter, retain } from "../core";

defineDataNode({
  key: "tasks",
  release: releaseAfter({ durationMs: 60_000 }),
  ...
});

// or, to opt out even when the runtime has a default:
defineDataNode({
  key: "pinnedReferenceData",
  release: retain(),
  ...
});
```

```ts
createGraphRuntime(graph, { releaseAfterMs: 300_000 });
```

Resolution order per node: its own `release` policy if declared, else the runtime's `releaseAfterMs` if set, else no automatic release for that node. A runtime with no default and no nodes opting in individually behaves exactly as it does today - this is additive, opt-in behavior, not a change to existing defaults.

### Mechanics

Implemented as a new sibling to the refresh-policy controller (`src/core/release-policies/`, mirroring `src/core/refresh-policies/`), reusing the same timer/environment/pause infrastructure built in Milestone 8 rather than inventing a second, parallel timer subsystem.

- A node's release timer starts the moment its subscriber count - **direct + required**, i.e. `hasSubscribers`, not the scheduler's `hasDirectSubscribers` - drops to zero, provided it currently `hasSuccessfulValue`. Resubscribing before the timer fires cancels it.
- On fire, the node resets to the same shape a never-executed node has: `data = initialValue`, `hasSuccessfulValue = false`, `status = "idle"`, `freshness = "stale"`, `error = null` - and **bumps `generation`**, so a later resubscribe goes through the exact same fresh-execution path as a node that never ran, rather than a special case bolted onto the existing generation-safety machinery in `execution.ts`.
- Emits a `node.value-released` diagnostic event, picked up by the Milestone 11 devtools Timeline once its category mapping is extended - a release should be visible there, not look like an unexplained reload.

### Scope

- **Data nodes only.** Context nodes cannot declare `release` at all - a context value is caller-provided input, not cache; releasing it would silently discard state the app set, a materially worse failure than a cache miss. Derived nodes are excluded from v1 too: synchronous and cheap to recompute, so releasing one buys little, and it can be added later without disruption if that turns out wrong.
- **Liveness signal is total subscribers (`hasSubscribers`), not direct-only.** Releasing a value some other still-mounted node still needs transitively would just force an immediate reload the instant that descendant re-executes - nearly always the wrong tradeoff. This is a different, unrelated use of subscription counts from the scheduler's own `hasDirectSubscribers` check (which decides what to actively refresh, not what's safe to release).
- **No refresh-policy special-casing needed.** Checked directly: refresh policies already stop entirely once a node's last subscriber leaves (Milestone 8), so by the time a release timer would start, any refresh policy on that node is already inert. There is no live conflict between the two to design around.

### Implementation note

The refresh-policy and release-policy controllers share one injected `timerEnvironment` runtime option rather than two near-identical clocks (`now`/`setTimeout`/`clearTimeout`/`random`/`isPaused`/`onPauseChange`) with different names. Since this package is unpublished (`private: true` in `package.json`), renaming the existing `refreshPolicyEnvironment` option cost nothing externally and avoided two names for the same shape of thing. Done as its own isolated, fully-verified step before the release-policy feature itself was built, so a rename mistake couldn't get tangled up with new feature bugs.

## Consequences

- A node's memory can be reclaimed automatically without the app doing anything, closing the gap described in Context - but only for nodes that opt in (via their own `release` or the runtime default), so existing graphs are unaffected until a consumer configures this.
- Every value-release transition must correctly bump `generation` and go through the same paths `execution.ts` already relies on elsewhere; this is the main correctness risk and needs dedicated tests proving a resubscribe-after-release triggers a genuinely fresh load rather than a stale-generation edge case.
- A global `releaseAfterMs` default is a guess, same as any duration-based default in any of the systems surveyed (TanStack Query's own 5-minute default is no less arbitrary) - the user guide's coverage of this feature is deliberately light on a recommended number for that reason, framing it as "pick based on how large the data actually is" rather than suggesting a one-size default.
- Because node slots are fixed in number, this bounds the _size_ of idle memory over time but not a hard ceiling the way a count-bounded release buffer (see Alternatives) would - a runtime with many large nodes all idle-but-not-yet-timed-out simultaneously can still spike memory in between fires. Judged an acceptable tradeoff for a simpler, more familiar mental model; revisit if real usage shows otherwise.

## Alternatives considered

### Explicit/manual release only (Apollo `cache.gc()`-shaped)

A `runtime.releaseIdleValues()` sweep the app calls when it knows it's safe, with no implicit timer. Simpler to test (no fake-clock involved) and zero background work, but does nothing unless the app remembers to call it - the same failure mode as SWR's lack of any eviction, which this milestone exists specifically to not be. Rejected as the _only_ mechanism; nothing rules out adding this as a manual escape hatch alongside the timer-based default later.

### Reference-counted release with a count-bounded release buffer (Relay-shaped)

Release immediately on last-unsubscribe, but keep the last N released nodes' values around anyway as a grace window sized by count rather than time - no wall-clock timer at all, and a genuinely hard memory ceiling. Rejected for this milestone on familiarity grounds: a duration-based default matches the mental model most people bring from TanStack Query and other timer-based caches, and reuses infrastructure (Milestone 8's timer environment) this project already has, tested, and trusts. A count-bounded buffer is a reasonable follow-up if a hard ceiling turns out to matter more than expected in practice - the two approaches aren't mutually exclusive.

### No automatic mechanism; document patterns instead

Given the "entry count can't grow" reframing in Context, ship only a manual primitive and a documented recipe for genuinely dynamic/parameterized reference data (a single node whose value is an app-managed map with its own LRU), rather than new automatic machinery. Rejected as not actually satisfying "long-running applications do not retain unused graph data indefinitely" (the Milestone 12 exit criterion) as automatic, default-capable behavior - punting entirely to the app is a materially weaker answer than what TanStack Query, Relay, and Apollo (once `gc()` is wired up) all provide by default or near-default.
