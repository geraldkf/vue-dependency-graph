# Graph Registry Implementation Note

## Status

Validation pending.

Milestone 1 source, tests, and documentation have been prepared and statically inspected in the contained environment. Type checking, Vitest, builds, and playground startup were not run.

## Files changed

### Core source

- `src/core/errors.ts`
- `src/core/graph.ts`
- `src/core/index.ts`
- `src/core/nodes.ts`
- `src/core/types.ts`
- `src/index.ts`

### Tests

- `tests/core/graph-registration.spec.ts`
- `tests/core/graph-validation.spec.ts`
- `tests/core/node-definitions.spec.ts`
- `tests/core/node-types.test.ts`

The bootstrap-only core smoke test was replaced by focused Milestone 1 tests.

### Documentation

- `docs/architecture/02-graph-and-node-model.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/06-graph-registry-implementation-note.md`

## Key decisions

- Node definitions are immutable descriptors and contain no runtime state.
- A definition is also its typed node handle.
- Graph topology is immutable after `createGraph`.
- Registry identity and validation use stable string keys.
- Parent indexes preserve declared dependency order.
- Child indexes use deterministic key order.
- Dependency resolvers support forward references and cycle tests without mutable definitions.
- Unknown inspection keys return empty relationship collections rather than throwing.
- Validation uses a small coded `GraphValidationError`.

## Static checks

The contained environment should verify:

- JSON files parse.
- No workspace or nested package manifests exist.
- Core boundary check passes.
- Core has no Vue, Pinia, devtools, or playground imports.
- No explicit `any` usage or unexplained TypeScript suppression exists.
- No execution or later-milestone modules were introduced.
- Required behaviour and type-test categories are represented.

These checks do not establish TypeScript correctness or passing tests.

## Offline validation

Run:

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check:boundaries
pnpm typecheck
pnpm test:run
pnpm build
pnpm dev
```

Return complete output for failures and confirm that the playground still renders.

## Known risks and questions

- Compiler feedback may require small adjustments to generic inference for dependency tuples.
- Lazy dependency resolvers rely on consumers returning stable synchronous definitions.
- The future runtime must cache resolved dependency topology from the graph indexes rather than repeatedly evaluating dependency resolvers.
- Milestone 2 must keep mutable status and data outside the immutable definitions.
