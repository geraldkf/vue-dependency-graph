# Compatibility and release contract

The package is pre-1.0. GitHub Releases remain the source of versioned tarballs. The first npm release may precede the bounded application migration trial planned for Helix; the trial will inform API stabilization at 1.0. While the version is `0.x`, the public API may change between minor versions; breaking changes are recorded in the [changelog](../../CHANGELOG.md).

The release workflow publishes the inspected tarball to npm only after the `NPM_PUBLISH_ENABLED` repository variable is set to `true` and npm trusted publishing is configured. Until then, it creates GitHub Releases without publishing to npm.

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

## npm publishing

1. For each release, update `package.json` and `CHANGELOG.md` to the same new version. The existing `v0.1.0` GitHub tag is already released and will not run the updated workflow.
2. For the first npm version, leave `NPM_PUBLISH_ENABLED` unset or set to `false`. Push the new version tag; the workflow validates, builds and inspects the tarball, then creates the GitHub Release without publishing to npm.
3. Publish that GitHub Release tarball once from an authenticated machine with npm 2FA enabled, using `npm publish vue-dependency-graph-x.y.z.tgz --access public`. This creates the package so its npm settings are available.
4. In the npm package settings, add a GitHub Actions trusted publisher for user `geraldkf`, repository `vue-dependency-graph`, workflow filename `release.yml`. Allow `npm publish`. The workflow uses Node 24, npm CLI latest, the repository's matching `repository.url`, and OIDC; npm generates provenance for public releases.
5. Set the GitHub repository variable `NPM_PUBLISH_ENABLED=true`. Later version tags will publish to npm and create the matching GitHub Release from the same inspected tarball.

Do not enable the repository variable before the package exists and the npm trusted publisher has completed a successful publish. The application migration trial remains planned for Helix and informs API stabilization at 1.0; it is not a prerequisite for this initial 0.x npm release.
