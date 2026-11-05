# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). While the version is `0.x`, the public API may change between minor versions; breaking changes are listed under "Changed (breaking)".

Release steps are in [Releasing a 0.x version](docs/maintenance/compatibility.md#releasing-a-0x-version-github-release).

## [Unreleased]

## [0.1.0] - 2026-11-04

First tagged release, distributed as a tarball on GitHub Releases. Pre-1.0: the API may still change, and API stabilization (1.0) and npm publication are gated on the existing-application migration trial.

### Added

- **Graph model.** Typed context, data and derived node definitions, validated by `createGraph` (duplicate keys, missing dependencies and cycles fail at startup). Nodes carry their literal `key` in their type, so `get(...)` rejects undeclared dependencies even between nodes with the same value type.
- **Runtime and scheduling.** `createGraphRuntime` with dependency-aware execution, subscription-driven loading, branch-scoped failures, a runtime-wide concurrency limit, abort handling that keeps the runtime live even when a loader ignores its signal, and scheduler flushes that overlap rather than block each other.
- **Vue integration.** `createGraphRuntimePlugin`, `useGraphRuntime`, and the `useNode`, `useNodes` and `useQuery` composables, with scope-safe subscriptions.
- **Transactions, events and queries.** Isolated atomic transaction sessions with conflict detection, typed events (`defineEvent`, `whenEvent` for conditional invalidation), and reusable query groups (`defineQuery`).
- **Refresh and release policies.** Stale-after, fixed-interval and poll-until refresh policies with bounded retry, backoff and jitter; automatic release of idle values via a per-node `release` option (milliseconds, or `Infinity` to never release) and the runtime's `releaseAfterMs` default.
- **Mutations.** Typed `defineMutation` and `runtime.mutate` with optimistic updates, guarded rollback, success effects (`update`, `invalidate`, `publish`), failure classification, and protection against reconciling into a context that changed mid-flight. A shared `GraphMutationError` base class with a `code` discriminant covers every mutation error.
- **Default mutation effects.** `defineMutation` accepts optional `optimistic`, `onSuccess` and `classifyFailure` as defaults for every call; a field passed to `runtime.mutate` replaces the default for that call. See [ADR-021](docs/decisions/ADR-021-mutation-default-effects.md).
- **Diagnostics and devtools.** Structured diagnostic events, metrics and snapshots; an embeddable `GraphDevtoolsPanel` and framework-independent protocol transforms. The panel's stylesheet ships separately as `vue-dependency-graph/devtools/style.css`.
- **Lifecycle.** `runtime.shutdown()` ends a runtime's lifetime: it aborts active work, rejects new operations, and clears listeners. The Vue plugin calls it when the app unmounts.
- **Packaging.** Three ESM entry points (`/core`, `/vue`, `/devtools`) with bundled declarations, loadable in plain Node and through bundlers, with Vue as an optional peer dependency.
- **Tooling and docs.** Parsed architecture-boundary checks, a built-package consumer check, a Chromium smoke check, scale benchmarks, a user guide, API reference, recipes, architecture documents and decision records.

### Known limitations

- ESM only; there is no package root export and no native CommonJS export (bundled CommonJS consumers are checked through esbuild).
- Browser smoke coverage targets Chromium only.
- SSR hydration, persisted cache restoration, distributed events and offline mutation queues are deferred.
- The devtools stylesheet must be imported separately by the consumer.
