# Vue Dependency Graph

Vue Dependency Graph is a proposed TypeScript-first data orchestration framework for Vue applications. It models application data as a dependency graph and coordinates demand, loading, invalidation, transactions, polling, events, derived state, failures, and diagnostics.

This repository begins as an isolated research and development project. The existing application implementation is reference material, not the new framework's architecture. Once the framework is stable and proven in the playground, it can be integrated into existing repositories through an explicit migration plan.

## Status

Design and prototyping. Milestones 1 through 7 are implemented, including the framework-agnostic runtime, subscription scheduler, Vue composables, Pinia-owned runtime integration, atomic local context transactions, typed event-driven invalidation, and reusable query groups.

Milestone 8 refresh policies and polling are implemented and validated. The runtime supports stale-after, fixed interval, typed poll-until completion and failure, timeout, bounded retry with backoff and jitter, pause/resume, optional browser lifecycle integration, and a deterministic Polling Progress playground. See `docs/implementation/86-milestone-8-implementation-summary.md`. APIs remain subject to change until the existing-application migration trial is complete.

Milestone 9 and Milestone 9H mutation correctness hardening are implemented and validated, including rollback hardening, updater protection, reconciliation recovery, immediate descendant loading, safe mutation event predicate reads, and the mutation-controller decomposition. Milestone 10 observability is proceeding sequentially; M10A through M10G diagnostic foundations, lifecycle causality, advanced diagnostics, metrics, safe snapshots, stable normalisation, and the Runtime Observability playground are implemented with offline and manual validation pending. See `docs/implementation/110-milestone-10-observability-plan.md`.

## Repository model

The project uses one repository and one package. Architectural areas remain logically separated by source folders rather than independently versioned workspace packages.

```text
vue-dependency-graph/
├── docs/
├── src/
│   ├── core/          Framework-agnostic graph engine
│   ├── vue/           Vue 3.5 integration
│   ├── devtools/      Optional diagnostics and inspector UI
│   ├── playground/    Playground application source
│   └── index.ts       Public library entry point
├── tests/
├── index.html         Playground entry document
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
└── vite.config.ts
```

The logical dependency direction remains:

```text
core
  ^
  |
vue

core <--- devtools

core + vue + devtools <--- playground
```

`src/core` must not import Vue or any other project layer. The separation is enforced through folder boundaries, TypeScript configuration, tests, and review rather than separately published packages.

## Primary goals

- Make data requirements declarative.
- Automatically load demanded data and its prerequisites.
- Remove manual `loadData()` calls from consumers.
- Allow multiple context changes to commit atomically.
- Support cross-store and cross-team invalidation through typed domain events.
- Preserve useful data while background refresh occurs.
- Provide first-class polling for long-running operations.
- Support independent branch failures without unnecessarily stopping the graph.
- Make execution observable through diagnostics, metrics, snapshots, and devtools.
- Provide strongly typed node definitions and consumer results.
- Keep the core independent of Vue and Pinia.

## Transaction ownership

Transaction-owned context changes and event publications use the explicit callback handle:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(JobSeekerId, 123);
  transaction.publish(AppointmentBooked, payload);
  await localWork();
});
```

Plain runtime calls do not join another caller's transaction:

```ts
runtime.setContext(UnrelatedContext, 999);
runtime.publish(UnrelatedEvent, payload);
await runtime.refresh([UnrelatedNode]);
```

They use committed graph state and proceed independently. If a transaction staged a context before an independent write changed that same context, commit rejects atomically with `GraphTransactionConflictError` and preserves the independent value. Transactions remain local graph transactions and do not roll back remote work.

## Non-goals

- Replace Pinia as the application's general-purpose client state store.
- Replace HTTP clients or backend SDKs.
- Persist an offline database in the first release.
- Implement distributed transactions across backend services.
- Couple one domain store directly to another domain store.
- Publish multiple independently versioned packages during the research phase.

## Technology baseline

- pnpm 12.4.1 for package management
- TypeScript with strict mode
- Vue 3.5
- Vite
- Vitest 3.0.7
- Vue Testing Library for Vue-facing behavioural tests
- ES modules

Exact dependency versions are established during repository bootstrap and verified offline by the developer.

## Execution responsibility

Generated implementation changes are prepared in a contained environment where dependency installation and reliable project execution are not assumed. Each implementation prompt therefore separates:

1. File generation and static inspection performed here.
2. Offline installation, type checking, testing, building, and runtime validation performed by the developer.
3. Follow-up fixes based on the developer's reported command output.

A milestone must not be marked complete solely because files were generated. Completion occurs only after the developer reports successful offline validation.

## Bootstrap commands

Enable Corepack and install dependencies offline:

```bash
corepack enable
pnpm install
```

Run validation:

```bash
pnpm check:boundaries
pnpm typecheck
pnpm test:run
pnpm build
pnpm dev
```

After the first install generates `pnpm-lock.yaml`, verify it with:

```bash
pnpm install --frozen-lockfile
```

## Documentation

- Public API: `docs/api/01-public-api.md`
- Architecture: `docs/architecture/01-system-overview.md`
- Vue and Pinia integration: `docs/architecture/07-vue-and-pinia-integration.md`
- Roadmap: `docs/implementation/01-roadmap.md`
- Test strategy: `docs/testing/01-test-strategy.md`
- Mutation hardening plan: `docs/implementation/95-milestone-9h-mutation-correctness-hardening-plan.md`

Historical implementation notes preserve point-in-time decisions and validation evidence. Use the documents above for the current architecture and API.
