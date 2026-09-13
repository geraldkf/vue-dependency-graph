# Milestone 4 V4C Implementation Note: Pinia-Backed Composable Integration

## Status

Prepared; offline validation pending.

## Objective

Prove the complete departmental integration path before changing the playground shell: Vue consumers resolve the graph runtime from an installed Pinia store and pass it explicitly to `useNode` and `useNodes`, without installing `createGraphRuntimePlugin`.

## Files changed

- `tests/playground/pinia-composable-integration.spec.ts` (new)
- `tests/playground/pinia-composable-integration-types.test.ts` (new)
- `docs/implementation/01-roadmap.md`
- `docs/implementation/25-vue-adapter-and-playground-plan.md`
- `docs/implementation/42-vue-adapter-v4c-pinia-composable-integration-note.md` (this file)

## Integration shape

```ts
const graphStore = useDependencyGraphStore();

const profile = useNode(userProfile, {
  runtime: graphStore.runtime,
});
```

The mounted tests install only Pinia:

```ts
render(Probe, {
  global: {
    plugins: [pinia],
  },
});
```

No graph runtime plugin is installed. A successful mount and load therefore demonstrate that the component uses V4A's explicit runtime path and V4B's store-owned runtime.

## Behavioural coverage

The integration tests verify:

- `useNode` loads through the Pinia-owned runtime
- mounting creates a direct graph subscription
- unmounting releases that subscription
- two independently mounted consumers use the same store runtime and share one node execution
- `useNodes` reads multiple nodes from the store runtime
- a context change invalidates and reloads dependent data through the same runtime

## Type coverage

The compile-time test verifies that retrieving the runtime from Pinia does not weaken composable result typing:

- `useNode(userProfile)` remains `string`
- `useNodes([selectedUserId, userProfile])` preserves each tuple position
- assigning profile data to `number` remains a type error

## Scope decision

V4C adds integration tests only. The five existing scenario components remain on their current injected-runtime path until V5G. Rewiring all scenarios and the shell together in V5G avoids a temporary mixed playground where some scenarios use injection and others use Pinia.

No library source, core source, node definitions, or Pinia store implementation changed in this step.

## Static inspection

- No `src/core` files changed.
- No graph runtime plugin is used by the new behavioural tests.
- Tests use the real Pinia store and real graph runtime rather than mocks.
- The dependency-free core boundary check passes.

## Offline validation

Apply V4A, V4B, and V4C in order, then run:

```text
pnpm install
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm install --frozen-lockfile
```

## Next task

V5G: rewire all five playground scenarios to retrieve the Pinia-owned runtime, replace the stub `App.vue` with the tabbed shell, and install Pinia once in `main.ts` without installing the graph runtime plugin.
