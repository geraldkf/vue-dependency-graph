# Contributing

## Before implementation

1. Read the relevant architecture document.
2. Confirm the active roadmap milestone and exit criteria.
3. Add or update an ADR for material design changes.
4. Keep changes within the active milestone.
5. Add behavioural tests with the implementation.
6. Add or update a deterministic playground scenario where applicable.

## Contained-environment workflow

Implementation is prepared in two stages.

### Stage 1: File preparation

The contained environment may:

- Create or update source, configuration, test, and documentation files.
- Perform static inspection of generated files.
- Check JSON and other formats where this does not require installing project dependencies.
- Package changed files for offline application.

It must not spend time installing dependencies, running development servers, or claiming that project commands passed when those commands cannot be executed reliably in the environment.

### Stage 2: Offline validation

The developer applies the files locally and runs the exact validation commands listed in the implementation prompt. The developer then reports:

- Command output
- Version conflicts
- Type errors
- Test failures
- Build failures
- Runtime observations

The next change should address that evidence with the smallest reasonable update.

## Completion status

Use these statuses in roadmap or implementation notes:

- `Prepared`: files have been generated and statically reviewed.
- `Validation pending`: offline commands have not yet been reported.
- `Validated`: the developer has reported that all required checks pass.
- `Blocked`: offline validation found an unresolved problem.

Do not mark a roadmap checkbox complete until the relevant offline validation has been reported as successful.

## Scope discipline

Do not add deferred features opportunistically unless they are required for correctness. Prefer small, reviewable changes.

## Architecture boundaries

The repository contains one package, but source layers remain logically separated:

- `src/core` must not import from `src/vue`, `src/devtools`, or `src/playground`.
- `src/vue` may import public core modules.
- `src/devtools` may import public core inspection contracts.
- `src/playground` may consume all public project layers.
- Cross-layer imports must use approved public or layer entry points, not arbitrary internal files.
- Node runtime state (`status`, `freshness`, `error`, `hasSuccessfulValue`, `data`, `generation`) is written only through the transitions in `src/core/state/transitions.ts`. The compiler enforces this: `NodeStateRecord` fields are `readonly`, so a direct assignment does not compile. Add or extend a transition instead, with a test in `tests/core/state-transitions.spec.ts`. `pnpm check:boundaries` also rejects a writable mapped type outside that file and keeps an allowlist of the modules allowed to import the transitions; adding a module to the allowlist is an architectural decision, so say why in the pull request.

## Documentation

Public API changes require updates to API documentation, migration notes, examples, and relevant implementation prompts.
