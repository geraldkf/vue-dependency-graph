# Implementation Prompt 001: Bootstrap the Single-Package pnpm Repository

## Role

You are bootstrapping `vue-dependency-graph`, a TypeScript-first dependency graph framework with a framework-agnostic core, a Vue 3.5 integration layer, optional devtools, and a Vue playground.

The project uses one repository and one package. Keep the areas logically separated under `src`, but do not create pnpm workspace packages, nested package manifests, or independently versioned packages.

Work only on repository bootstrap. Do not implement graph nodes, scheduling, transactions, events, polling, mutations, devtools functionality, or framework examples beyond minimum placeholders needed to establish the project structure.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture/01-system-overview.md`
- `docs/implementation/01-roadmap.md`
- `docs/testing/01-test-strategy.md`

If the repository differs from these documents, state the discrepancy and make the smallest reasonable adjustment.

## Environment constraint

You are working in a contained environment. Do not spend time installing dependencies, running pnpm commands, starting Vite, executing tests, or building the project.

Your responsibilities are to:

1. Create or update the required files.
2. Perform static inspection that does not require dependency installation.
3. Check file consistency and obvious configuration mistakes.
4. Provide the exact offline validation commands for the developer.
5. Mark command results as `Not run in contained environment`.

The developer will apply the files offline, run the commands, and return any errors or observations. Do not claim that installation, type checking, tests, builds, CI, or the development server succeeded.

## Objective

Create a clean single-package pnpm repository with logical source boundaries and the foundation for later milestones.

Target structure:

```text
vue-dependency-graph/
├── docs/
├── src/
│   ├── core/
│   │   └── index.ts
│   ├── vue/
│   │   └── index.ts
│   ├── devtools/
│   │   └── index.ts
│   ├── playground/
│   │   ├── App.vue
│   │   ├── main.ts
│   │   └── env.d.ts
│   └── index.ts
├── tests/
│   ├── core/
│   ├── vue/
│   ├── devtools/
│   └── playground/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
├── .nvmrc
├── index.html
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
├── vite.config.ts
└── vitest.config.ts
```

A different test placement is acceptable if the repository already has a consistent convention. Do not retain obsolete `packages/*`, `apps/*`, or `pnpm-workspace.yaml` files from the earlier multi-package proposal.

## Assumptions

Use these defaults unless the repository already establishes another convention:

- One private pnpm package
- TypeScript strict mode
- Vue 3.5
- Vite
- Vitest 3.0.7
- Vue Testing Library
- ES modules
- Package name: `vue-dependency-graph`
- Node.js and pnpm versions declared in root configuration

Do not assume the latest dependency versions. If no versions are established, choose mutually compatible stable versions and clearly list them as proposed versions requiring offline verification.

## Scope

### 1. Root package

Create or update:

- `package.json`
- `pnpm-lock.yaml` only if it can be produced without pretending an install occurred; otherwise document that the developer must generate it offline
- `tsconfig.json`
- `tsconfig.build.json`
- `vite.config.ts`
- `vitest.config.ts`
- `.gitignore`
- `.nvmrc`
- `.editorconfig` only when no repository convention exists
- `index.html`

Do not create:

- `pnpm-workspace.yaml`
- Nested `package.json` files
- Turborepo or Nx configuration
- Independent package build pipelines

The root `package.json` must:

- Be private
- Declare `packageManager`
- Declare supported Node.js versions
- Provide scripts for:
  - `build`
  - `test`
  - `test:run`
  - `typecheck`
  - `dev`
- Use one dependency set for the repository

Avoid adding linting or formatting tools unless already established. This milestone is bootstrap, not tooling expansion.

### 2. TypeScript configuration

Enable at minimum:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `useUnknownInCatchVariables`
- `forceConsistentCasingInFileNames`
- `skipLibCheck`

Use modern ES module and bundler-compatible resolution appropriate for Vite.

Compile the library-facing source with declaration output capability. Exclude playground-only code from the library build where necessary.

### 3. Logical core layer

Bootstrap `src/core`.

Requirements:

- No Vue, Pinia, DOM, browser lifecycle, devtools, or playground imports
- Minimal public entry point
- One smoke test through the core entry point
- No graph behaviour yet

Add the simplest practical boundary check that detects forbidden core imports. Prefer a small deterministic test or script over a new dependency.

### 4. Logical Vue layer

Bootstrap `src/vue`.

Requirements:

- May import through the public core layer entry point
- Minimal public entry point
- One smoke test proving the Vue layer can consume the core layer
- No `useNode`, plugin, or reactive graph implementation yet

### 5. Logical devtools layer

Bootstrap `src/devtools`.

Requirements:

- May import public core inspection placeholders only
- Minimal public entry point
- No visualisation or Vue devtools integration
- Core and Vue layers must not depend on devtools

### 6. Playground

Bootstrap the root Vite application using `src/playground`.

Requirements:

- Render a minimal page identifying Vue Dependency Graph and the logical layers
- Consume only public layer entry points
- Include one component smoke test with Vitest 3.0.7 and Vue Testing Library
- Avoid framework demonstrations or scenario controls

### 7. Public entry points

Use clear entry points so logical boundaries remain visible in one package.

At minimum:

- `src/core/index.ts`
- `src/vue/index.ts`
- `src/devtools/index.ts`
- `src/index.ts`

If `package.json` exports are added, keep them minimal and consistent with the eventual import shapes:

```text
vue-dependency-graph
vue-dependency-graph/core
vue-dependency-graph/vue
vue-dependency-graph/devtools
```

Do not add speculative APIs merely to populate exports.

### 8. Logical dependency boundaries

Enforce:

```text
core
  ^
  |
vue

core <--- devtools

core + vue + devtools <--- playground
```

Rules:

- Core imports none of the other layers and does not import Vue.
- Vue imports public core modules only.
- Devtools imports public core inspection modules only.
- Playground may consume all public layers.
- Avoid arbitrary cross-layer internal imports.

### 9. Continuous integration

If no CI exists, add one minimal GitHub Actions workflow containing the offline commands the repository should run:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:run
pnpm build
```

Do not run the workflow or report it as successful from the contained environment.

Do not add publishing, releases, coverage gates, or deployment.

### 10. Documentation

Update only documentation affected by concrete bootstrap conventions.

At minimum:

- Root `README.md` installation and command instructions
- `docs/implementation/01-roadmap.md` status set to `Prepared` or `Validation pending`, not `Validated`
- A short implementation note listing proposed dependency versions and offline validation steps
- An ADR only if the implementation materially deviates from the accepted single-package design

## Quality requirements

- Keep changes limited to repository bootstrap.
- Prefer simple configuration.
- Do not add speculative abstractions.
- Do not use `any` unless required at a third-party boundary and documented.
- Do not suppress TypeScript errors pre-emptively.
- Keep core independent of Vue.
- Ensure generated output, caches, coverage, and installed dependencies are ignored.
- Keep tests network-free and deterministic.
- Remove obsolete multi-package bootstrap files if they exist.
- Do not invent a successful lockfile. If a lockfile requires offline installation, leave it for the developer and state that clearly.

## Static inspection in the contained environment

Perform only checks that do not require project dependencies, such as:

- List generated files.
- Parse `package.json` as JSON.
- Inspect TypeScript configuration inheritance and paths manually.
- Confirm no nested `package.json` or `pnpm-workspace.yaml` remains.
- Search `src/core` for forbidden imports.
- Confirm CI and documentation commands match root scripts.
- Confirm the ZIP or change set contains the intended files.

Report these as static checks, not build validation.

## Offline validation for the developer

Ask the developer to run from the repository root:

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test:run
pnpm build
pnpm dev
```

After `pnpm install` generates or updates `pnpm-lock.yaml`, also run:

```bash
pnpm install --frozen-lockfile
```

The developer should return:

- Node.js version
- pnpm version
- Full output for failed commands
- Any warnings about peer dependencies or configuration
- Confirmation that the playground renders

## Prepared acceptance criteria

The contained-environment change is ready for offline validation when:

- One root `package.json` exists.
- No pnpm workspace file or nested package manifests remain.
- Logical source folders and entry points exist.
- Core has no obvious Vue or cross-layer imports.
- The playground bootstrap and smoke tests are present.
- Root scripts and CI commands are consistent.
- Documentation identifies validation as pending.
- No later framework milestone is implemented.

## Validated acceptance criteria

Milestone 0 is complete only after the developer reports:

- Dependency installation succeeds.
- The lockfile is generated and frozen installation succeeds.
- Type checking succeeds.
- Smoke tests succeed.
- The library and playground build succeeds.
- The playground starts and renders.
- Any reported failures have been fixed and revalidated.

## Expected completion response

Provide:

1. A concise summary of files prepared.
2. Files added, changed, and removed.
3. Proposed dependency versions requiring offline verification.
4. Static checks performed and their results.
5. Offline commands not run in the contained environment.
6. Exact developer validation steps.
7. Assumptions, deviations, and likely risks.

Do not claim project commands passed unless the developer later reports that result.
