# Vue Dependency Graph

Vue Dependency Graph is a proposed TypeScript-first data orchestration framework for Vue applications. It models application data as a dependency graph and coordinates demand, loading, invalidation, transactions, polling, events, derived state, failures, and diagnostics.

This repository begins as an isolated research and development project. The existing application implementation is reference material, not the new framework's architecture. Once the framework is stable and proven in the playground, it can be integrated into existing repositories through an explicit migration plan.

## Status

The initial framework capabilities are implemented and validated. The runtime includes graph execution and scheduling, Vue integration, isolated atomic transaction sessions, typed events, query groups, refresh policies and polling, typed and optimistic mutations, diagnostics, devtools, automatic value release, retention hardening, and overlapping scheduler flushes.

The next active objective is a bounded existing-application migration trial. APIs remain subject to change until that trial establishes production-shaped compatibility and adoption guidance. See the [roadmap](docs/ROADMAP.md).

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
await runtime.transaction(async (transaction) => {
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

Each top-level `runtime.transaction(...)` call owns an independent session. To compose work into the same atomic boundary, use the transaction handle explicitly:

```ts
await runtime.transaction(async (transaction) => {
  transaction.setContext(JobSeekerId, 123);
  await transaction.transaction(async (nested) => {
    nested.publish(AppointmentBooked, payload);
  });
});
```

`runtime.whenSettled()` is scheduler-specific. Await the transaction first, then call `whenSettled()` when commit-triggered scheduler work must finish. An unrelated open transaction does not keep the scheduler unsettled.

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
- Vitest 4.1.11
- Vue Testing Library for Vue-facing behavioural tests
- ES modules

Dependency versions are pinned in package.json and pnpm-lock.yaml. See the [dependency maintenance policy](docs/maintenance/dependencies.md).

## Execution responsibility

Run validation locally and in CI. Record commands and outcomes against the actual checkout. If an environment cannot execute a check, report it as pending; static inspection is not a passing test run. API compatibility and publication remain gated by the [application migration trial](docs/maintenance/migration-trial.md).

## Bootstrap commands

Use Node 22.13 or newer, enable Corepack, and install the locked dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Run validation:

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

Run the playground or measure graph cascades:

```bash
pnpm dev
pnpm benchmark # requires a current build
```

## Documentation

- User guide: `docs/guides/00-user-guide.md`
- Public API: `docs/api/01-public-api.md`
- Architecture: `docs/architecture/01-system-overview.md`
- Vue and Pinia integration: `docs/architecture/07-vue-and-pinia-integration.md`
- Roadmap: `docs/ROADMAP.md`
- Test strategy: `docs/testing/01-test-strategy.md`
- Compatibility and lifecycle: `docs/maintenance/compatibility.md`
- Performance measurements: `docs/maintenance/performance.md`
- Staged maintenance record: `MAINTENANCE.md`

Historical implementation notes preserve point-in-time decisions and validation evidence. Use the documents above for the current architecture and API.
