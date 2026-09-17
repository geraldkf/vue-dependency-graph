# Core Feature-Folder Restructure Implementation Note

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Prepared; offline validation pending.

## Objective

Reorganise `src/core` from a flat directory of 17 files into feature folders, each holding its own small `types.ts` next to its own capability file, so contract and implementation are distinguishable by folder rather than by the `runtime-` filename prefix alone — and, in the same move, eliminate two circular type-import edges that ran through `runtime.ts`.

## Why this was needed

Every file in `src/core` split cleanly into two roles that the flat layout did not make visually obvious: a contract file (`types.ts`, `errors.ts`, `execution.ts`, `operations.ts`, `scheduler.ts`, `subscription.ts` — types and interfaces, near-zero logic) and a capability file (`graph.ts`, `nodes.ts`, and every `runtime-*.ts` file — the stateful behaviour). The only signal distinguishing them was the `runtime-` prefix, undocumented as a convention.

More concretely: `runtime.ts`, the composition root, also hosted several shared runtime-level types (`RuntimeListener`, `NodeFreshness`, `NodeStatus`, `NodeRuntimeState`, `RuntimeNodeData`). Two capability modules needed those types and imported them back from `runtime.ts` — the thing that assembles them:

- `runtime-observer.ts` imported `RuntimeListener` from `./runtime`
- `runtime-state.ts` imported `NodeFreshness`/`NodeStatus`/`NodeRuntimeState`/`RuntimeNodeData` from `./runtime`

Both were `import type`, so TypeScript erased them and nothing broke at runtime, but the dependency direction was backwards: a composition root should depend on its capabilities, never the reverse.

## Chosen layout

Feature folders rather than a single global `contracts/` vs `capabilities/` split. A global split would have every capability's contract file share a basename with its implementation file across two parallel folders (`contracts/scheduler.ts` next to `capabilities/scheduler.ts`), which reproduces a milder version of the same ambiguity it set out to fix. Grouping by feature keeps each `types.ts` unambiguous because it is always read together with the folder it sits in, and mirrors the one structural decision this repo already had right — splitting `src/core`/`src/vue`/`src/devtools` by domain, not by types-vs-implementation.

```
src/core/
  graph/        graph.ts, nodes.ts, node.ts (was types.ts), errors.ts
  execution/    execution.ts (was runtime-execution.ts), types.ts (was execution.ts)
  state/        state.ts (was runtime-state.ts), types.ts (new — extracted from runtime.ts)
  observation/  observer.ts (was runtime-observer.ts), types.ts (new — extracted from runtime.ts)
  subscriptions/ subscriptions.ts (was runtime-subscriptions.ts), types.ts (was subscription.ts)
  scheduling/   scheduler.ts (was runtime-scheduler.ts), types.ts (was scheduler.ts)
  invalidation/ invalidation.ts (was runtime-invalidation.ts)
  operations/   operations.ts (was runtime-operations.ts), types.ts (was operations.ts)
  transactions/ notification-buffer.ts (was runtime-notification-buffer.ts)
  runtime.ts    composition root only — createGraphRuntime + GraphRuntime interface
  index.ts      public barrel
```

`node.ts` (not `types.ts`) inside `graph/` — the file describes node/graph vocabulary specifically, and "types" would have been redundant with the five other `types.ts` files it now sits alongside in the tree.

## Files changed

Every file under `src/core` moved or had its internal import specifiers rewritten. Two files gained new content:

- `src/core/state/types.ts` (new) — `NodeStatus`, `NodeFreshness`, `RuntimeNodeData`, `NodeRuntimeState`, extracted out of `runtime.ts`
- `src/core/observation/types.ts` (new) — `RuntimeListener`, extracted out of `runtime.ts`
- `src/core/runtime.ts` — import specifiers repointed at the new locations; the five extracted type definitions removed from its body (imported instead); no other logic changed
- `src/core/index.ts` — every re-export specifier repointed at the new locations; the set of exported names is unchanged
- Every other file listed under "Chosen layout" above — moved, with only its `import`/`from` specifiers rewritten to match its new location. No function, type, or exported name was renamed, added, or removed.
- `docs/implementation/01-roadmap.md`
- `docs/implementation/24-core-feature-folder-restructure-implementation-note.md` (this file)

No `docs/implementation/prompts/` file was added, consistent with the previous note's departure from the note/prompt pairing convention.

Historical implementation notes and prompts (numbered 04 through 22) that reference the old flat file paths in their own "Files changed" sections were left untouched. Those are point-in-time records of what each past change actually touched; rewriting them to the new paths would falsify the historical record rather than correct it.

## What did not change

- No exported name, type, or function signature changed. `src/core/index.ts` exports the identical set of names it did before this note.
- No test file was changed. All 30 test files import exclusively from the public barrel (`../../src/core`), never from an internal path, so none needed touching.
- `scripts/check-boundaries.mjs` needed no changes — it already recurses into subdirectories and only pattern-matches import strings, not specific file paths.
- No runtime behaviour changed. This is a pure move-and-repoint refactor.

## Verification

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 98/98 tests (unchanged from before this note), clean typecheck, clean boundary check. Confirmed separately that no file other than `index.ts` imports from `./runtime` or `../runtime` any more — both circular type-import edges described above are gone.

## Next task

None scheduled by this note. This was a structural clarity change, not a milestone deliverable.
