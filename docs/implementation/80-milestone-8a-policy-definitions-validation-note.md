# Milestone 8A: Refresh Policy Definitions and Validation

## Status

Complete and validated as part of the combined Milestone 8 checkout.

## Scope

M8A adds immutable, strongly typed refresh-policy metadata for data-node definitions. It intentionally adds no timers, automatic refresh, polling sessions, retry execution, pause handling, browser integration, or playground behaviour.

## Implemented public API

```ts
staleAfter({ durationMs: 30_000 });
refreshInterval({
  intervalMs: 60_000,
  retry: { strategy: "fixed", maxRetries: 2, delayMs: 1_000 },
});
pollUntil<ReportProgress>({
  intervalMs: 2_000,
  timeoutMs: 600_000,
  stopWhen: value => value.state === "completed",
  failWhen: value => value.state === "failed",
});
```

Only data nodes accept the optional `refresh` property. Context and derived nodes remain unchanged.

## Validation and immutability

Policy factories validate required durations, retry counts, backoff values, jitter, and polling predicates. They copy and freeze the returned descriptor and nested retry descriptor. Defaults are applied for zero jitter and an exponential multiplier of two.

Graph construction defensively validates forged policy metadata and reports `GraphValidationError` with code `INVALID_REFRESH_POLICY`. It also rejects forged policy metadata on context and derived nodes. Policy predicates are retained but never evaluated by definition or graph construction.

## Files added

- `src/core/refresh-policies/types.ts`
- `src/core/refresh-policies/policy.ts`
- `tests/core/refresh-policy-definitions.spec.ts`
- `tests/core/refresh-policy-types.test.ts`
- `docs/implementation/80-milestone-8a-policy-definitions-validation-note.md`

## Files updated

- `src/core/graph/types.ts`
- `src/core/graph/node.ts`
- `src/core/graph/graph.ts`
- `src/core/graph/errors.ts`
- `src/core/index.ts`
- `docs/api/01-public-api.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/decisions/ADR-012-refresh-policies-and-polling.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/78-milestone-8-refresh-polling-plan.md`
- `docs/testing/01-test-strategy.md`
- `docs/README.md`

## Coverage prepared

Behavioural tests cover descriptor normalization, immutability, defaults, invalid numeric settings, malformed predicates, data-node integration, and defensive graph validation.

Compile-time tests cover polling value types, mismatched policy values, reusable stale and interval policies, required options, retry strategy typing, and rejection on context and derived nodes.

## Validation completed in the contained environment

- Core boundary check passed.
- Strict TypeScript compilation of `src/core/**/*.ts` passed with the available compiler.
- Focused strict TypeScript compilation of the new compile-time policy test passed.

The exact repository command suite subsequently passed against the combined Milestone 8 checkout.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Do not mark M8A validated until all four commands pass against the combined checkout.

## Next task

After offline M8A validation, proceed with M8B: runtime policy controller, deterministic environment, subscription ownership integration, and stale-after behaviour.
