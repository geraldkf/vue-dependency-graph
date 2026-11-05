# Test suite review

Reviewed on 2026-10-03 against commit `e0dc845`.

## Assessment

The suite is a strong maintenance foundation. It needs targeted consolidation and some stronger interaction tests, rather than a rewrite or a large reduction in test count. Most core tests already exercise observable behavior through the public runtime. Vue integration, real Pinia ownership, production-browser scenarios, diagnostic traces, compile-time contracts, and garbage collection provide complementary coverage.

The main weaknesses are accumulated regression files, duplicated timer fixtures, a few misleading descriptions, and some tests whose setup does not actually create the risky condition their name suggests. High coverage does not resolve those weaknesses.

This review inventories the entire suite and examines implementation and assertions in the principal execution, scheduling, transaction, mutation, policy, lifecycle, Vue, devtools, and tooling families. Proposed removals below are assertion-level consolidation candidates; they are not a claim that every similarly named test is redundant. No tests or production code were changed during the review.

## Baseline and scope

| Area       | Runtime spec files |
| ---------- | -----------------: |
| Core       |                 93 |
| Vue        |                  9 |
| Devtools   |                  7 |
| Playground |                 19 |
| Retention  |                  3 |
| Tooling    |                  1 |
| Total      |                132 |

There are also 18 compile-time `.test.ts` files. They are included by `tsconfig.json`, checked by `vue-tsc`, and intentionally excluded from the Vitest runtime projects. No skipped, exclusive, or TODO test declarations were found in the inventory.

Current verification on Node 24:

- All 132 runtime files and 725 tests passed with coverage enabled.
- Type checking passed, including the compile-time test files.
- Coverage: 95.62% statements, 88.82% branches, 97.93% functions, 96.78% lines.

The CI configuration also runs Node 22.13, built-package consumer checks, and production Chromium checks. Those additional checks were inspected but not rerun for this review. The coverage scope includes core, Vue, and devtools TypeScript; it does not measure the playground or establish comprehensive rendered-component coverage. One successful run is not evidence that the suite is free of timing flakes.

## 1. Add public-runtime coverage for incremental release reconciliation

**Priority: high.** This is the most valuable coverage addition following the recent implementation changes.

`tests/core/release-policy-incremental.spec.ts` is a useful algorithm test: it proves that a controller reconsiders changed keys instead of scanning 100 nodes, deduplicates changes, cancels a timer when demand returns, and unregisters tracking on disposal. Keep it. However, it constructs the controller directly, manually marks demand changes, and invokes reconciliation itself. It cannot prove that the complete runtime wires all relevant changes into that controller.

Existing public release tests already cover ordinary expiry, resubscription, required ancestor demand, defaults, opt-out, diagnostics, and fresh loading after release. Retention tests add timer accumulation and actual value collection. Add a small public-runtime interaction matrix around the remaining integration risks:

| Scenario                                                                       | Observable assertions                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Undemanded prefetch followed by unrelated graph changes                        | The value releases at the intended deadline; unrelated notifications do not extend it or create another timer.     |
| Several eligible nodes change through a transaction or mutation                | Every affected node receives the correct release behavior; an unaffected node keeps its deadline.                  |
| A synchronous change listener subscribes or unsubscribes another eligible node | Demand changes are not lost during reconciliation; retained and released values match current demand.              |
| Two runtimes share the same graph definition                                   | Their demand, timers, and released values remain independent; stopping policies in one does not disable the other. |

Use `createGraphRuntime`, deterministic time, and public state/demand observations. Avoid replacing these with more calls to private tracking methods. These are proposed regression guards, not confirmed production defects.

Do not add a duplicate generic disposal test: `runtime-dispose.spec.ts` already proves that loading continues after policy disposal while timers remain inert; `runtime-shutdown.spec.ts` separately covers terminal lifetime behavior.

## 2. Consolidate older transaction tests

**Priority: medium.** This is the clearest cleanup opportunity.

| Existing case                                                                   | Finding                                                                                                                 | Recommended owner/action                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transaction-session-isolation.spec.ts`: conflict between “overlapping calls”   | The first transaction is awaited before the second starts. The conflict is caused by an independent `setContext` write. | Remove this redundant variant after checking the corresponding assertion in `transaction-conflicts.spec.ts`. Keep genuine overlap coverage in `transaction-overlap-conflicts.spec.ts`. |
| Same file: disjoint sessions “in either completion order”                       | Only the second transaction finishing first is exercised.                                                               | Consolidate into `transaction-overlap.spec.ts`; parameterize both completion orders if that is the intended contract.                                                                  |
| Same file: successful session plus failed session                               | Related coverage exists in `transaction-overlap.spec.ts`, but this variant writes the same context.                     | Preserve the same-context success/rollback guarantee in the canonical overlap suite before retiring the old file. Assert the specific failure rather than merely any `Error`.          |
| `transaction-staging.spec.ts`: “allows guarded operations again”                | The name describes the older guard model; the test runs execution after an empty transaction has already completed.     | Consolidate with the current operation-isolation contract, or rename if its post-completion guarantee is retained.                                                                     |
| Same file: plain passthrough outside a transaction                              | It only performs ordinary context writes and checks notifications.                                                      | Place that notification contract in context/observer coverage if it is not already asserted there.                                                                                     |
| `transaction-events.spec.ts`: “transaction settlement” waits for scheduler work | The transaction is awaited first; the promise held pending is `runtime.whenSettled()`.                                  | Rename to describe scheduler settlement after an event commit. Keep the event-triggered reload assertion.                                                                              |

The older session-isolation header also links to a removed implementation plan. Replace historical references with the current contract.

Keep staging visibility, event atomicity, rollback without cancellation, conflict metadata, and settlement tests. They exercise distinct guarantees even when their fixtures look similar. In particular, two transactions being open together is different from an independent context write racing a transaction.

## 3. Strengthen and reorganize mutation regressions

**Priority: medium.** `mutation-decomposition-safety.spec.ts` is named after an implementation migration, but most of its assertions remain valuable behavioral contracts.

The weakest case is “does not let a no-op optimistic draft retain ownership”: it awaits the first mutation before starting the second. That proves ownership is gone after settlement, but would still pass if the no-op draft incorrectly reserved ownership until settlement.

Hold the first remote request open with a deferred promise. Start a real optimistic mutation on the same node while that request is pending. Assert that it can update successfully, then settle the no-op request and check that it does not disturb the newer value. This tests the actual ownership boundary.

Move the remaining useful cases into their behavioral families:

- No-op optimistic drafts: optimistic mutation coverage.
- Throwing failure classifier: outcome coverage, retaining the stronger assertions that the classifier runs once, one unknown-outcome transition occurs, and the original cause survives.
- Retained success-effect handles: success-effect lifetime coverage.
- Earlier publication followed by a failing later predicate: atomic success-effect/event coverage.
- Ownership release after affected-derived reconciliation failure: reconciliation-failure coverage, preserving the derived-node variant.

Some existing outcome and reconciliation tests cover simpler versions of these cases. Merge assertions rather than deleting the stronger variants because their names are similar.

## 4. Share deterministic clock primitives

**Priority: medium.** Timer environments are rebuilt in interval, stale-after, polling, retry/pause, release, disposal, and trace tests. Interval and stale-after contain identical helper implementations; other copies differ mainly in pause, random, and inspection support.

Extract a small test clock supporting current time, deterministic scheduling/cancellation, pending timer inspection, pause notifications, and a supplied random sequence. Keep node definitions and business scenarios local so each test remains readable.

Preserve timer semantics during extraction. Some helpers jump to the final time and drain due callbacks; trace helpers process a snapshot of pending callbacks. A helper that replays every intermediate timestamp or newly created timer can change the behavior being tested. Explicitly support or retain the exceptional semantics needed by trace and late-cancelled-callback tests.

Do not introduce a universal runtime fixture with many options. The existing `deferred` and named `waitForCondition` helpers are a good scale for shared infrastructure.

## 5. Split scheduling coverage by contract

**Priority: medium.** `scheduler-overlap.spec.ts` is about 961 lines and mixes concurrency, sharing, settlement, diagnostics, reentrancy, cancellation, and private request-tracker behavior.

Split it into focused suites for:

- Shared attempts, concurrency limits, and queued work.
- Scheduler settlement, bursts, and out-of-order results.
- Listener/loader reentrancy and cancellation.
- Diagnostic attribution, with the direct request-tracker test in a focused internal suite.

Preserve the interleavings: an ignored abort, queued cancellation, loader reentry, and listener reentry are distinct cases. Splitting the file is a navigation improvement, not a reason to reduce those assertions.

The case named “runtime is disposed mid-flight” also unsubscribes immediately after `dispose()`. Its settlement therefore does not establish that policy disposal alone cancels active work. Describe the combined policy-stop/final-unsubscribe behavior accurately; terminal shutdown is covered elsewhere.

Several suites use a zero-delay macrotask `flush`. Prefer a named observable condition where possible, but do not replace every barrier with a fixed number of microtasks. Garbage-collection checks and deliberate event-loop boundaries have different requirements.

## 6. Expand generated tests into controlled asynchronous sequences

**Priority: medium, after the targeted gaps above.** `generated-interactions.spec.ts` runs six fixed seeds with 80 operations each. It is useful serial state-machine coverage, but it waits for settlement after every step and uses immediately resolving loaders. It does not explore arbitrary in-flight completion orders.

Keep the serial test and add a bounded asynchronous variant with controlled pending loads/mutations and explicit resolve/reject operations. Start with a small graph, then one diamond or independent branch. Include context changes while work is pending, demand removal/readdition, and known rejection versus unknown outcome.

Use an independent expectation model for current values, demand, and obsolete results. Add seed, step number, and the operation trace to failure messages. Request-count expectations should describe specific guarantees such as deduplication; the current `requests > 0` check alone cannot catch extra requests.

Keep CI seeds fixed and failures reproducible. Handwritten race tests should remain: they explain the contract and pinpoint failures more clearly than generated sequences.

## 7. Small housekeeping and assertion ownership

**Priority: low.**

- `tests/setup.ts` already registers Testing Library cleanup globally. Remove redundant local cleanup in playground polling-progress and transaction-isolation tests while preserving any separate timer teardown.
- Its comment about approximately 110 jsdom files is stale; the current DOM project contains 38 spec files. Avoid hard-coded suite-size explanations.
- `vitest.config.ts` quotes an outdated approximate coverage baseline. Describe the intent of the thresholds without implying current numbers.
- `docs/testing/01-test-strategy.md` says to add a type-test mechanism despite already documenting the existing compile-time suite. Update that section to describe present coverage and specific remaining contracts.
- The store-disposal suite spies on `shutdown`, while its comment and `disposeCalls` helper still refer to `dispose`. Rename them to distinguish owner shutdown from stopping background policies. The real runtime is retained underneath the spy, which is a useful integration boundary.
- `diagnostic-regression.spec.ts` overlaps substantially with the broader golden trace. Its explicit causal relationships and terminal outcome assertions are still useful. Consolidate them into a canonical diagnostic scenario if desired; do not discard them merely because a snapshot also contains those events.

## Coverage worth preserving

| Layer                      | Why similar-looking tests are not automatically redundant                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Focused units              | State transitions, equality rules, event indexing, timer boundaries, and limiter behavior give precise failure localization.      |
| Public runtime scenarios   | Prove that independently tested components are wired together correctly.                                                          |
| Vue and Pinia              | Exercise real scope/unmount ownership and reactivity rather than just runtime demand counters.                                    |
| Devtools                   | Protocol transformations, live/offline composables, and panel interactions validate different interfaces.                         |
| Diagnostics                | Golden trace checks order/attribution; state trace checks visible transitions. Neither replaces all focused causality assertions. |
| Retention                  | Balanced counters do not prove collection. Keep WeakRef/GC checks, held-reference controls, and non-cooperative attempt tests.    |
| Type tests                 | Runtime assertions cannot establish inference or rejection of invalid TypeScript usage.                                           |
| Package and browser checks | Source entry-point tests do not prove built exports work; jsdom cannot replace production Chromium behavior.                      |

There is no reason to turn every test into a browser test or to move everything under an “integration” directory. Classify by the contract being protected, and share only infrastructure that does not hide the scenario.

## Recommended implementation sequence

1. **Correct descriptions and strengthen the no-op ownership test.** Update stale testing documentation and remove redundant cleanup. Run affected suites, type checking, lint, and formatting.
2. **Add incremental-release interaction tests.** Cover public wiring before removing overlapping coverage. Run policy, mutation, transaction, and retention suites.
3. **Extract clock infrastructure.** Migrate one suite at a time while preserving advancement behavior, callback ordering, and pause/random semantics. Run all timer-dependent suites and both traces.
4. **Consolidate transaction/mutation regressions and split scheduling.** Record an old assertion-to-new-owner map. Where redundancy is uncertain, verify that the retained test fails under the relevant deliberate fault before removing the older case.
5. **Add the asynchronous generated sequence test.** Keep it deterministic and modest in size. Run the complete coverage suite and the full CI checks after the final restructuring.

Judge the result by readable contracts, reproducible failures, and preserved fault detection. A smaller test count or higher coverage percentage is not, by itself, an improvement. Do not lower thresholds to accommodate consolidation, and do not add trivial implementation-mirroring tests solely to recover percentage points.
