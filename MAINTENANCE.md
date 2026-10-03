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

## Remaining application evidence

The [migration trial](docs/maintenance/migration-trial.md) needs a real application's workflow, flag/rollback path and measured acceptance results. It is the remaining prerequisite for API stabilization/publication. No publication was performed.

The [performance baseline](docs/maintenance/performance.md) shows substantial cascade cost around 1,000 data plus 1,000 derived nodes. The benchmark makes that cost observable; it does not establish browser performance or justify an unmeasured scheduler rewrite. Measure the application's graph and demand before selecting a further optimization.
