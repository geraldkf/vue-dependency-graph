# Dependency maintenance

Use pnpm 12.4.1 as pinned in package.json and commit only pnpm-lock.yaml. Install with `pnpm install --frozen-lockfile` in CI and when validating an unchanged dependency set. The local nested checkout is ignored and is not a workspace package.

Review updates monthly or when a relevant security advisory appears. Inspect release notes, runtime requirements, peer compatibility, and migration notes before changing versions. Group tightly related packages together: Vue/compiler, Vite/plugin, Vitest/coverage, and ESLint/plugins. Keep Playwright and its Chromium installation aligned.

For each update, commit the manifest and pnpm lockfile together and run the release validation sequence. Run `pnpm audit` when registry access is available, inspect applicability, and record unresolved results. A successful test run is not a vulnerability audit. Do not use a forced major-version upgrade solely to silence audit output.

Upgrade the package-manager pin deliberately, separately from unrelated library changes. CI's frozen installation detects lockfile drift. When execution or registry access is unavailable, preserve source changes and report the unperformed checks explicitly.

On 3 October 2026, the audit found advisories in Vite 6.2.2 and Vitest 3.0.7. Vite was updated to 6.4.3 and Vitest/coverage to 4.1.11; Vitest's workspace and pool settings were migrated to its current projects and execArgv configuration. The subsequent audit reported zero advisories. Coverage thresholds remain unchanged despite the newer runner's more precise coverage remapping.
