# Milestone 7: Final Validation Handoff

## Status

Implementation and documentation prepared. Final combined automated and manual validation pending.

## Automated validation

Run from the repository root after applying M7A through M7D and the validation-fix package:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Record the actual outcome of each command. Do not infer success from an earlier partial run.

## Expected focused suites

Confirm that the following Milestone 7 suites are discovered:

```text
tests/core/query-definitions.spec.ts
tests/core/query-types.test.ts
tests/core/query-operations.spec.ts
tests/core/query-operation-types.test.ts
tests/vue/use-query.spec.ts
tests/vue/use-query-types.test.ts
tests/playground/scenarios/query-groups.spec.ts
```

Compile-time `.test.ts` files are checked by `vue-tsc` rather than executed by Vitest.

## Previously reported corrections

The first combined validation run exposed two narrow issues:

- the `useQuery(...)` scope-guard test expected wording inconsistent with the existing shared guard;
- the `prefetchQuery` and `refreshQuery` object-literal callbacks inferred implicit `any` parameters during repository type checking.

The test now follows the existing scope-guard regex convention, and both callbacks explicitly accept `AnyQueryDefinition`. Rerun all commands rather than only the previously failing commands.

## Manual Query Groups validation

Run:

```text
pnpm dev
```

Then complete the **Query Groups** checklist in `docs/PLAYGROUND.md`.

At minimum, confirm:

- initial request counts and direct subscriptions are zero;
- prefetch loads both data requirements while subscriptions remain zero;
- mounting the consumer reuses fresh prefetched data without another request;
- aliased appointment, capability, and summary results are correct;
- aggregate state reports loading false, error false, and success true after settlement;
- refresh advances both request counts and updates all aliased results;
- unmount returns direct subscriptions to zero;
- switching tabs releases mounted query subscriptions without warnings.

## Result recording

If all automated and manual checks pass:

- change Milestone 7 status in `docs/implementation/01-roadmap.md` to **Complete and validated**;
- update `README.md` and `docs/README.md` with the validation date;
- update `docs/implementation/76-milestone-7-implementation-summary.md` with the actual command and manual outcomes;
- retain exact reported test totals only when they are available from the final run.

If validation fails:

- preserve the complete command output;
- fix only the observed defect;
- add or adjust the narrowest relevant test;
- rerun all four automated commands;
- repeat manual validation if Vue or playground behaviour changed.
