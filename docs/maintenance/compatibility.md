# Compatibility and release contract

The package remains private at version 0.0.0. API stabilization and publication require the existing-application trial in the roadmap.

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

## Before a release

1. Complete and record the bounded application trial, including rollback evidence.
2. Run frozen-lockfile installation, lint, formatting, boundaries, typechecking, full coverage, build, consumer checks, and browser checks on the release checkout.
3. Record Node and package-manager versions. Review declaration and export changes and update migration notes.
4. Review dependency updates and benchmark comparisons. Request counts and cleanup are correctness gates; timing comparisons need the same machine and workload.
5. Select a release version and changelog, then intentionally change private/publication metadata. Do not publish as a side effect of ordinary maintenance.
