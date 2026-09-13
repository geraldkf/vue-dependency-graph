## Milestone 4 V4A Implementation Note: Explicit Runtime Support

### Status

Prepared; offline validation pending.

### Objective

Allow `useNode` and `useNodes` to consume a `GraphRuntime` supplied explicitly by an application-level owner such as a Pinia store. This avoids requiring the graph runtime plugin in applications where changing the root application bootstrap requires a separate approval process.

### Files changed

- `src/vue/composable-options.ts` (new)
- `src/vue/use-node.ts`
- `src/vue/use-nodes.ts`
- `src/vue/index.ts`
- `tests/vue/composable-runtime-options.spec.ts` (new)
- `tests/vue/composable-runtime-options-types.test.ts` (new)
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/25-vue-adapter-and-playground-plan.md`
- `docs/implementation/40-vue-adapter-v4a-explicit-runtime-implementation-note.md` (this file)

### Public API

```ts
useNode(Targets, { runtime });
useNodes([Targets, Permissions], { runtime });
```

`GraphComposableOptions` is exported from the Vue public barrel:

```ts
export interface GraphComposableOptions {
  readonly runtime?: GraphRuntime;
}
```

The existing plugin-based calls remain valid:

```ts
useNode(Targets);
useNodes([Targets, Permissions]);
```

### Runtime resolution

Runtime resolution uses one deterministic rule:

1. Use `options.runtime` when supplied.
2. Otherwise resolve the runtime through `useGraphRuntime()`.
3. If neither exists, preserve the existing explicit missing-runtime error.

An explicit runtime therefore takes precedence when both an explicit and injected runtime are present.

### Architectural boundary

This step does not add Pinia to the library. It only adds the narrow seam required for an application or playground Pinia store to own the runtime. Graph state remains owned by `GraphRuntime`; it is not copied into Vue or Pinia state.

No core files or runtime behaviour changed. Subscription creation, state dirty-checking, scheduler behaviour, and scope-disposal cleanup remain unchanged.

### Tests

Behavioural tests cover:

- `useNode` with an explicit runtime and no plugin injection
- `useNodes` with an explicit runtime and no plugin injection
- mount and unmount subscription lifecycle through the explicit runtime path
- explicit runtime precedence over an injected runtime

Compile-time tests cover:

- public `GraphComposableOptions` typing
- `useNode` data inference with explicit runtime options
- `useNodes` tuple-preserving inference with explicit runtime options
- rejection of a value that is not a `GraphRuntime`

### Static inspection

- No `src/core` files changed.
- No Pinia dependency was added.
- The dependency-free core boundary check passed.
- Existing one-argument composable calls remain source-compatible.
- The explicit runtime path still runs inside the existing effect-scope guard.
- The Vue public barrel exports only the options contract, not the internal resolver.

### Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

### Next task

V4B: add the playground Pinia store that owns one `GraphRuntime` per Pinia instance, without mirroring graph state into Pinia.
