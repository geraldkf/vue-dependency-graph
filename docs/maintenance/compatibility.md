# Compatibility and release contract

The package is pre-1.0. Releases are distributed as tarballs attached to GitHub Releases, built by the release workflow from a version tag. `package.json` keeps `"private": true` so the package cannot be published to npm by accident. While the version is `0.x`, the public API may change between minor versions; breaking changes are recorded in the [changelog](../../CHANGELOG.md).

API stabilization (1.0) and npm publication remain gated on the existing-application trial in the roadmap. A `0.x` GitHub release does not require the trial.

## Supported consumption

- ESM entry points: `/core`, `/vue`, `/devtools`, and `/devtools/style.css`. There is no package root export or native CommonJS export. Bundled CommonJS consumers are checked through esbuild.
- Node 22.13 or newer is the declared baseline. CI validates Node 22 and 24. Core code is tested in Node; Vue/UI and browser lifecycle tests run in jsdom and Chromium.
- Vue 3.5 or newer within the declared major-version peer range is required for Vue and devtools entry points. It is optional for core-only consumers. Pinia is an integration choice.
- Modern browsers need ES2022, AbortController, and queueMicrotask. Browser smoke coverage currently targets Chromium; other browsers are not certified by that check.
- SSR hydration, persisted runtime cache restoration, distributed events, and offline mutation queues remain deferred. Diagnostic snapshots are inspection artifacts.

## Ownership and reconciliation

An application or Pinia store creates one runtime for a coherent workflow and calls `shutdown()` when its lifetime ends. `stopBackgroundPolicies()` and legacy `dispose()` stop timers while allowing ordinary runtime work. Read-only inspection works after shutdown; new operations and registrations fail with `GraphRuntimeShutdownError`. Handle pending promise rejections during owner teardown. This error does not prove that a remote mutation was rejected.

Direct mutation success updates cannot reconcile into a target whose transitive context changed during the command. Catch `GraphMutationReconciliationError`, inspect `remoteSucceeded`, preserve the new selection, and fetch authoritative state when appropriate. Invalidation/event-only effects still require correctly scoped payloads and predicates. Mutation updaters must return immutable replacements.

An optimistic draft whose context changes before remote execution rejects with `GraphMutationConflictError` without sending the request. Direct success reconciliation also checks immediately before commit so caller callbacks cannot change identity underneath a prepared draft.

## Releasing a 0.x version (GitHub Release)

1. Run frozen-lockfile installation, lint, formatting, boundaries, typechecking, full coverage, build, consumer checks, and browser checks on the release checkout. The release workflow repeats all of them and refuses to release if any fails.
2. Record Node and package-manager versions. Review declaration and export changes against the previous release.
3. Review dependency updates and benchmark comparisons. Request counts and cleanup are correctness gates; timing comparisons need the same machine and workload.
4. Set the new version in `package.json` and add a matching `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`. Breaking changes go under their own "Changed (breaking)" heading.
5. Commit, then tag the commit `vx.y.z` and push the tag. The release workflow checks that the tag, `package.json` and the changelog agree, builds the tarball, and creates the GitHub Release. Versions below 1.0.0 are marked as pre-releases.

Do not tag as a side effect of ordinary maintenance.

## Before 1.0 or npm publication

1. Complete and record the bounded application trial, including rollback evidence.
2. Everything in the 0.x list above.
3. Add `repository`, `homepage` and `bugs` to `package.json`, remove `"private": true`, and decide the npm access and provenance settings. Publishing is a separate, deliberate step from the GitHub release.
