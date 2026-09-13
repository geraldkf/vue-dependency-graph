# Milestone 4 V4B Implementation Note: Pinia-Owned Graph Runtime

## Status

Prepared; offline validation pending.

## Objective

Create the playground integration shape used by the departmental application: Pinia is already installed, and a Pinia store owns and exposes the graph runtime. Components will consume that runtime through V4A's explicit runtime option rather than requiring the graph runtime Vue plugin.

## Files changed

- `package.json`
- `src/playground/playground-graph.ts` (new)
- `src/playground/dependency-graph-store.ts` (new)
- `tests/playground/dependency-graph-store.spec.ts` (new)
- `docs/implementation/01-roadmap.md`
- `docs/implementation/25-vue-adapter-and-playground-plan.md`
- `docs/implementation/41-vue-adapter-v4b-pinia-runtime-implementation-note.md` (this file)

## Design

`playgroundGraph` assembles the nodes already defined by the five playground scenarios. Their existing namespaced keys allow them to coexist in one validated graph.

The setup store creates the runtime inside its factory:

```ts
export const useDependencyGraphStore = defineStore("dependencyGraph", () => {
  const runtime = markRaw(createGraphRuntime(playgroundGraph));

  return {
    runtime,
  };
});
```

This gives one stable runtime per Pinia instance and prevents accidental sharing between independently created application or test instances.

## State ownership

Pinia owns only the runtime instance. It does not duplicate graph values, statuses, errors, generations, subscription counts, or scheduler state. `GraphRuntime` remains the single source of truth and continues to publish changes through its own observation API.

The runtime is wrapped in `markRaw` because it is an existing closure-based service object with its own observation mechanism. Vue does not need to proxy it.

## Dependency

Pinia `3.0.4` is added as a pinned dependency. No lockfile was present in the supplied repository, so this step does not invent one. The developer must generate or update the lockfile through the normal offline install workflow.

## Tests

The store tests verify:

- repeated store access under one active Pinia instance returns the same store and runtime
- the runtime is not converted into a Vue reactive proxy
- separate Pinia instances receive different runtimes
- context state changes in one runtime do not affect another runtime

V4B deliberately does not change scenario components or `main.ts`. V4C will prove the composables against the Pinia-owned runtime, and V5G will install Pinia and wire the complete playground shell.

## Static inspection

- No `src/core` files changed.
- The graph contains each existing scenario node exactly once.
- The store creates the runtime inside the store factory, not at module scope.
- No graph state is mirrored into Pinia.
- The dependency-free core boundary check passes.

## Offline validation

Run:

```text
pnpm install
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

After the install creates or updates `pnpm-lock.yaml`, also run:

```text
pnpm install --frozen-lockfile
```

## Next task

V4C: mount Vue consumers with Pinia, retrieve the store-owned runtime, and pass it explicitly to `useNode` and `useNodes` without installing the graph runtime plugin.
