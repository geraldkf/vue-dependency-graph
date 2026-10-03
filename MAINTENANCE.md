# Maintenance work

Each stage was validated before continuing. Public API changes are documented with their compatibility implications. All repository stages below are implemented; changes remain local for review.

1. Protect mutation success updates against context changes; repair terminal polling restart.
2. Observe diagnostic collector changes in devtools.
3. Resolve the accidental nested checkout entry, lockfile ambiguity, lint roots, and formatting scope.
4. Add explicit terminal runtime shutdown while preserving background-policy disposal compatibility.
5. Add interaction coverage, separate Node and DOM test environments, and browser smoke coverage.
6. Add repeatable scale benchmarks and strengthen parsed import boundaries.
7. Refresh onboarding, release contracts, dependency maintenance, and migration guidance.
8. Run all checks against the combined checkout and record results.

The existing-application migration requires an application workflow outside this repository. This repository can provide the trial checklist and rollback criteria, but cannot certify an unavailable application.

## Completed stages

| Stage | Result                                                                                                                                                                                                                                             | Checks                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Context generation checks prevent late mutation results and pre-start optimistic drafts from updating a different entity. Polling terminal state resets for a new generation, including completed and failed jobs.                                 | Mutation/context, optimistic reconciliation, polling and retry regression suites.                                                       |
| 2     | Diagnostic collector subscriptions keep the timeline current even without a graph state change. Export reads a current snapshot; scope cleanup cancels queued updates.                                                                             | Collector isolation and devtools lifecycle/export tests.                                                                                |
| 3     | Removed the accidental Git index entry for the nested checkout, preserving its local files. Ignored that checkout in tooling, removed the npm lockfile, and fixed the ESLint root. Test-only multiple-component fixtures are explicitly supported. | Lint, formatting, pnpm frozen installation.                                                                                             |
| 4     | Added terminal `shutdown()` and `GraphRuntimeShutdownError`, retaining legacy policy-only `dispose()` and its clearer alias. Vue, Pinia and standalone scenario owners terminate their runtimes.                                                   | Active/queued loaders, ignored cancellation, transactions, optimistic ownership, callback reentrancy, integration and retention checks. |
| 5     | Core/tooling run in Node; UI/integration and retention run in jsdom. Added six seeded interaction sequences and a production Chromium smoke script used by CI.                                                                                     | Full suite and browser checks across all 14 scenarios, rapid context switching, unsubscribe cleanup and polling completion.             |
| 6     | Parsed TypeScript/Vue import boundaries replace regex checks, with checker regressions. Added repeatable benchmarks with exact load-count and cleanup assertions; release reconciliation excludes unconfigured nodes.                              | 129 source files checked; 100/500/1,000 data-node scale runs with diagnostics and observer variants.                                    |
| 7     | Updated onboarding, ADRs, lifecycle examples, compatibility/release contracts, dependency policy and the bounded application migration plan. Updated Vite to 6.4.3 and Vitest/coverage to 4.1.11 in response to the audit.                         | Types, full coverage on Node 22.13.0 and 24.19.0, built exports and zero audit advisories.                                              |
| 8     | Validated the combined implementation; CI is configured for Node 22 and 24.                                                                                                                                                                        | See final validation below.                                                                                                             |

## Final validation

Local checks on Windows, pnpm 12.4.1:

- All 721 tests in 130 files pass on Node 22.13.0 and Node 24.19.0.
- Coverage thresholds are unchanged: statements 95.55%, branches 88.56%, functions 97.73%, lines 96.74%. Vitest 4 uses more precise coverage remapping, so these percentages are not directly comparable to the earlier Vitest 3 baseline.
- Typechecking and parsed architecture boundaries pass.
- Production library/playground build and package-consumer checks pass, including ESM, bundled CommonJS, and production/development mutation guards.
- Chromium smoke passes all 14 scenarios and the targeted context, demand cleanup and polling workflows.
- Registry audit reports zero advisories after the grouped tooling update.

- Lint passes with zero errors and zero warnings (`--max-warnings 0`); formatting and frozen-lockfile installation pass.
- Built consumer checks also pass on Node 22.13.0. The final benchmark passes all 12 configurations with exact request counts and zero remaining demand after shutdown.

CI configuration has been updated; these are local results, not a claim that a remote CI job has already run.

## Approved follow-up work

1. Completed [reference-data caching guidance](docs/recipes/10-reference-data-and-cache-budgets.md): retained lists, large values, runtime defaults, bounded keyed maps, release-duration selection and runtime ownership. Corrected the older release recipe and completed the roadmap's documentation follow-up.
2. Expanded production Chromium checks using the new Runtime Ownership scenario and the Polling Progress new-job control. Checks cover navigation during an active mutation, pending request/mutation shutdown, handled errors, aborted signals, suppressed late value commits/success callbacks, fresh owner operation, and polling restart after completion/failure. All 15 scenarios are visited.
3. Extended the benchmark to 72 configurations with sparse demand, isolated branch changes and release-policy controls. Added exact per-node load/derivation and whole-graph cleanup assertions, saved workload measurements and CPU profile summaries. The evidence identifies full release-policy scans as the next optimization target; runtime behavior was not changed in this profiling stage.

Validation: 721 tests in 130 files pass on Node 22.13.0 and 24.19.0, with unchanged coverage thresholds passing on Node 24. Lint has zero warnings; types, formatting and 130-file architecture checks pass. Production build, built-consumer and expanded Chromium checks pass. All 72 benchmark configurations pass their assertions on Node 24; the six small workload/release-control configurations also pass on Node 22.

## Remaining application evidence

Incremental release reconciliation now replaces the repeated eligible-node scan with changed-node tracking. State transitions and direct/required demand changes record keys before synchronous notification; initialization retains one full pass. The 72-case comparison preserves exact request, derivation, notification and retained-event counts, with the 1,000-node full-demand release-enabled median decreasing from 938.10 ms to 11.15 ms on the same local host. See the [comparison and raw results](docs/maintenance/performance.md#incremental-release-reconciliation). The application migration trial is deferred at the owner's request.

The [migration trial](docs/maintenance/migration-trial.md) needs a real application's workflow, flag/rollback path and measured acceptance results. It is the remaining prerequisite for API stabilization/publication. No publication was performed.

The [performance baseline and incremental comparison](docs/maintenance/performance.md) record removal of the repeated release scan around 1,000 data plus 1,000 derived nodes. These measurements do not establish browser performance or justify an unmeasured scheduler rewrite. Measure the application's graph and demand before selecting a further optimization.
