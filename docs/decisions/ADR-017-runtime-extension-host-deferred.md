# ADR-017: Runtime extension host deferred

## Status

Accepted. Implementation is intentionally deferred pending a revisit trigger.

## Context

While decomposing `runtime.ts` (roadmap: "Runtime architecture consolidation") an internal **ExtensionHost** was proposed as the last stage: a small host that owns reactive background policies (today refresh and release), hands each a narrow semantic context, isolates their failures, collects their diagnostics, and disposes them in order. A public `options.extensions` API was to follow only if justified.

That stage was proposed before the earlier stages existed. Once they were done, the proposal was checked against the code as it then stood.

| What the host would add | State of the code |
| --- | --- |
| Failure isolation between policies | `RuntimeObserver.notify` already wraps every listener in try/catch, and the two policies listen through it. The real gap was that failures vanished silently; that is fixed separately (below). |
| Ordered, idempotent lifecycle and disposal | Done: `runtime.dispose()` and `composition/policy-services.ts` detach the hooks first, then stop both controllers. |
| A shared policy contract | The only shared surface is `reconcile` and `dispose`. The refresh controller (about 500 lines) has pause and resume, retry, polling state and a diagnostics snapshot; the release controller (about 170 lines) has none of that. The glue a host would generalise is about 20 lines in `policy-services.ts`. |
| Diagnostics contributed by policies | One contributor (refresh). Release contributes none. |
| Selective dispatch (reconcile only what changed) | A performance question, not a structural one. Measured on one machine, roughly: about 4 µs per change notification with no policy nodes, about 41 µs with 100, about 330 µs with 1,000, about 2.6 ms with 5,000 - roughly 0.5 µs per policy node per notification. A dirty set inside each controller would fix it if it ever matters; no host is needed. |
| "Verbs, not mechanisms" for extensions | Needs bound, key-based transitions injected into controllers, so that they hold no state references at all. That touches the dependency types of about 12 files and the mutation planner's captured state. It pays off only for policies that are external or untrusted. Today's rule (read-only state record, transitions-only writes, an allowlist of importing modules) already stops accidental writes. |
| A public extension API | Not on the roadmap. The package is single, private and in a research phase; a public extension surface would be an early commitment to a shape with only two, dissimilar, implementations behind it. |

The roadmap's deferred capabilities (persistent cache restoration, cross-tab synchronisation, SSR hydration) would need different hooks - snapshot and hydrate, an event bridge - than a policy-only host offers, so building the host now risks fixing the wrong abstraction.

## Decision

**Do not build an ExtensionHost, a policy extension interface, or a public extension API now.** Refresh and release stay two directly composed controllers in `composition/policy-services.ts`.

Instead, one gap the analysis found is closed: listener and policy failures are no longer swallowed silently. `RuntimeObserver` takes an `onListenerError` callback, and the runtime reports each failure as a `runtime.listener-failed` diagnostic event (attributed to the operation being committed when there is one). Isolation is unchanged; only visibility is added.

## Consequences

- No new abstraction, no new public surface, and no prerequisite refactor of controller dependencies.
- A broken policy (for example a timer environment that throws) is now visible in diagnostics and the devtools Timeline instead of disappearing. With diagnostics disabled it is still isolated and unreported, as before.
- Adding a third policy means composing it by hand in `policy-services.ts`, as the first two are. That is cheap while there are few of them, and it is what will show whether a common shape exists.
- Reconcile cost grows linearly with the number of policy nodes. Acceptable at the sizes this framework's static graphs are expected to reach; see the trigger below.

## Revisit when

Any one of these is enough to reopen this decision:

1. **A third policy with different needs.** The likeliest candidate is a count-bounded release buffer or LRU eviction (ADR-016 records it as a reasonable follow-up), which would sit on `releaseValue` but decide by count rather than by time. Building it by hand first is the test of whether a shared shape exists.
2. **Policies defined outside core.** For example, something the existing-application migration trial needs that cannot be expressed with the built-in policies.
3. **Measured reconcile cost.** Profiling that shows policy reconciliation mattering, roughly beyond 1,000 policy nodes. Try a dirty set inside the controllers first.

## If it is revisited

Keep what the analysis concluded, so it does not have to be rediscovered:

- Internal first; no `options.extensions` until there is a concrete external need.
- Policies remain the only extension category until a second, genuinely different category exists.
- Extensions receive a small semantic context - read access to state, subscriber checks, and named actions such as "refresh this policy node" and "release this value" - never raw state, `notify`, `schedule` or `execute`, and no shared "runtime context" bag. Controllers keep receiving narrow dependency objects.
- This requires the bound, key-based transitions first (roadmap), so that extension code cannot hold a state reference.
- The host owns registration, failure isolation, diagnostics collection and disposal. Disposal detaches the host from the runtime's change notifications before disposing extensions, and is idempotent.
- Extensions get a shared contract test suite: `reconcile` is safe to repeat, `dispose` is idempotent and prevents further work, a snapshot is safe after dispose, and an extension cannot write state directly.

## Alternatives considered

### Build the host now, internal only

Cheap to start and it would give the two policies a uniform shape. Rejected for now: the uniform shape already exists in two methods, and everything else the host adds is either done (lifecycle, isolation) or needs the bound-transition refactor first. A host built before a third example is more likely to encode the accidents of refresh and release than a real common shape.

### Tiny internal `{ reconcile, dispose }` list inside `policy-services`

Would remove the duplicated hook and dispose wiring for about 15 lines. Not done: a saving that small does not justify a new type, and a list makes the required order (refresh before release) less visible than the two explicit calls do.

### Public extension API straight away

Rejected: nothing in the roadmap or the migration plan needs it, and it would commit the package to a shape before the policies behind it have been compared.
