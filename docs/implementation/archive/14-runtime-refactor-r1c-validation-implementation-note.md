# Runtime Refactor R1C Validation Implementation Note

## Status

Validation pending.

## Objective

Standardise private registered-node validation while preserving key-based identity, atomic mutation boundaries, public APIs, and current failure timing.

## Files changed

- `src/core/runtime.ts`
- `tests/core/runtime-context.spec.ts`
- `tests/core/execution-order.spec.ts`
- `tests/core/refresh.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/14-runtime-refactor-r1c-validation-implementation-note.md`
- `docs/implementation/prompts/007c-runtime-refactor-r1c-validation.md`

## General registered-node helper

`requireRegisteredNode(...)` remains the single private key-based lookup. It returns the graph's registered definition and includes the supplied key when lookup fails.

## Context validation

`requireRegisteredContextNode(...)` composes registered-key lookup with a context-kind check. `setContext(...)` remains synchronous, resolves equivalent handles by key, and mutates the registered context state only after validation succeeds.

## Refreshable-node validation

Refresh keeps its existing single-pass complete-list validation because this preserves current failure timing: missing targets throw before a promise is returned, while defensive context-node rejection returns a rejected promise. All targets are still validated before generation mutation.

A separate refreshable helper was intentionally not added because it would either obscure the atomic loop or risk changing the distinct missing-target and context-target timing.

## Execution and prefetch validation

Execution validation remains inside the async `executeInternal(...)` boundary, but now reuses `requireRegisteredNode(...)`. Unknown explicit execution and prefetch targets therefore remain rejected promises. Complete target resolution still occurs before any loader starts.

## Atomic validation guarantees

- Subscription resolves all targets before count mutation.
- Refresh resolves all targets before generation mutation.
- Execution and prefetch resolve all targets before execution begins.
- Equivalent handles resolve through registered keys.

## Error timing guarantees

- Subscription and context validation remain synchronous.
- Missing refresh targets preserve the existing synchronous throw.
- Context-node refresh preserves the existing rejected-promise behavior.
- Missing execution and prefetch targets remain rejected promises.
- Unknown-target errors remain separate from `GraphExecutionError`.

## Tests

Tests were added for equivalent context, execution, and refresh handles; invalid context handles; atomic explicit execution and refresh validation; and defensive context refresh rejection. Existing subscription and prefetch tests already cover equivalent handles and atomic missing-target validation.

## Preserved behavior and API

Public APIs, exports, R1B helpers, notification calls, scheduler behavior, operation ownership, and the single execution engine were intentionally preserved.

## Static checks

Static checks cover public interface and export equality, private helper usage, key-based lookup, atomic mutation ordering, error timing structure, R1B helper equality, notification-call equality, source boundaries, explicit `any`, suppressions, console logging, roadmap status, and ZIP integrity.

## Project commands

Not run in contained environment.

## Offline validation

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

## Next task

R1D: Document notification ownership.
