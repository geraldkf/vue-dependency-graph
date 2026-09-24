# Snippets for docs/README.md

Add under maintained documents / guides:

```md
- [UI, Pinia, and the dependency graph](./guides/01-ui-and-pinia-graph.md) — department default: Pinia owns the runtime; component roles; status UI
- [Recipes](./recipes/) — including [Pinia runtime ownership](./recipes/07-pinia-runtime-ownership.md)
```

In `docs/architecture/07-vue-and-pinia-integration.md`, add at the end of the intro or ownership section:

```md
For component roles, context ownership, status rendering, and migration checklists under the Pinia-owned runtime path, see [UI, Pinia, and the dependency graph](../guides/01-ui-and-pinia-graph.md).
```
