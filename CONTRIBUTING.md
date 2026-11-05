# Contributing

Read the relevant architecture document and active roadmap objective before implementation. Add or update an ADR for material design changes. Keep changes reviewable, add behavioral regressions for correctness changes, and update public API documentation and examples.

## Local and CI validation

Use the package-manager version in package.json, Node 22.13 or newer, and pnpm-lock.yaml. Install with `pnpm install --frozen-lockfile`. Do not create a second package-manager lockfile.

Run:

```bash
pnpm check:boundaries
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage
pnpm build
pnpm check:consumer
pnpm exec playwright install chromium
pnpm check:browser
```

`pnpm benchmark` compares scale behavior after a current build. Compare timing on the same host; exact request counts and cleanup are asserted. CI validates Node 22/24 and uses Chromium's `--with-deps` installation on Linux.

Record actual command results and runtime versions for the combined checkout. Use `Prepared`, `Validation pending`, `Validated`, or `Blocked` accurately. If execution is unavailable, explain which checks remain unperformed. File generation or static review alone does not establish a completed milestone. External migration trials require measured application evidence.

## Architecture and lifetime

- Core must remain independent of Vue, Pinia, and other source layers.
- Vue and devtools consume public core entry points. Playground consumes public project layers. Parsed boundary checks cover static imports, re-exports, dynamic/type imports, aliases, and Vue script blocks.
- Node state fields are readonly outside `src/core/state/transitions.ts`. Extend named transitions instead of creating writable mapped views. Allowed transition owners live in `scripts/boundary-rules.mjs`; additions require an architectural explanation.
- Runtime owners use `shutdown()` at the end of their lifetime. `stopBackgroundPolicies()` and legacy `dispose()` are policy-only operations. Handle shutdown rejections from pending promises; remote work cannot be undone.
- Mutation updaters return immutable replacements. Direct success updates reject if their transitive context changed while the command was pending; remote success and local reconciliation failure are distinct.
- Retention tests require `--expose-gc`, supplied by the configured fork pool. A skipped retention check proves nothing.

Core/tooling tests run in Node. Vue, playground, devtools, and retention tests run in jsdom. Real-browser smoke tests supplement both. Prefer deterministic clocks, condition-based waits, and public-API assertions.

## Maintenance references

- [Compatibility and release contract](docs/maintenance/compatibility.md)
- [Dependency policy](docs/maintenance/dependencies.md)
- [Performance baseline](docs/maintenance/performance.md)
- [Application migration trial](docs/maintenance/migration-trial.md)

Releases follow [Releasing a 0.x version](docs/maintenance/compatibility.md#releasing-a-0x-version-github-release). Do not publish to npm, tag 1.0, or mark the migration trial complete without its recorded exit evidence.
