# Milestone 0: Repository Bootstrap

## Status

Configuration complete; pnpm lockfile generation and final offline command validation pending.

## Delivered foundation

- One private package rather than a multi-package workspace
- Node.js 22.13 or newer
- pnpm 12.4.1 declared consistently in `package.json` and CI
- Strict TypeScript configuration
- Logical `src/core`, `src/vue`, `src/devtools`, and `src/playground` boundaries
- Public root and layer entry points
- Vite playground
- Vitest and Vue Testing Library infrastructure
- Dependency-free core boundary validation
- GitHub Actions validation workflow

## Package-manager convention

pnpm is the only package manager for this repository.

```json
{
  "packageManager": "pnpm@12.4.1",
  "engines": {
    "node": ">=22.13.0"
  }
}
```

The repository must contain `pnpm-lock.yaml` and must not contain `package-lock.json` or another package-manager lockfile. pnpm is tooling selected through the `packageManager` field and is not an application runtime dependency.

The current pnpm version was selected as the latest stable release when this summary was prepared. Future upgrades must update `package.json`, CI, and relevant documentation together.

## Root commands

```text
corepack enable
pnpm install
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

After generating or updating the lockfile:

```text
pnpm install --frozen-lockfile
```

## Validation required to close the milestone

- `pnpm-lock.yaml` is generated and committed with pnpm 12.4.1
- Frozen installation succeeds
- Core boundary validation succeeds
- Type checking succeeds
- Tests succeed without unhandled rejections
- Build succeeds
- Playground starts successfully

Manual browser validation of the later Pinia-backed playground has already been reported successful. That evidence confirms the bootstrap application can run, but the final pnpm 12.4.1 lockfile and command suite must still be reported before Milestone 0 is marked fully validated.

## Historical record

The original bootstrap prompt and prepared-file manifest are removed from active documentation because they describe pre-implementation constraints and placeholder files that no longer represent the repository. Git history remains the source for that point-in-time detail.
