# ADR-001: Framework Foundation

## Status

Accepted, implemented, and validated.

## Context

The existing Vue service validated useful concepts but combines Vue reactivity, graph structure, execution, subscriptions, and application assumptions. Continuing to expand it in place would make experimentation risky and could preserve accidental constraints.

The initial proposal used separate workspace packages for the core, Vue adapter, devtools, and playground. Independent packaging is not currently required and would add configuration and build overhead during rapid framework exploration.

## Decision

Create a separate `vue-dependency-graph` repository as one pnpm package with logically separated source folders:

- `src/core`
- `src/vue`
- `src/devtools`
- `src/playground`

Use the existing service as behavioural reference material, not source architecture.

Enforce logical dependency directions through entry points, TypeScript configuration, tests, and code review. Do not introduce independent package manifests or pnpm workspace packages at this stage.

## Consequences

- Repository bootstrap and local development are simpler.
- All framework areas use one dependency and build configuration.
- Core isolation must be enforced without relying on package-manager boundaries.
- Independent publication and versioning are deferred.
- The source tree can be split into packages later if actual consumers require it.
- Integration into an existing application still requires an explicit migration milestone.
