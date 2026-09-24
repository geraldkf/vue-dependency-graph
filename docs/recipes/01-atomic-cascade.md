# Recipe 01 — Atomic cascade on parent context change

**Status:** research-phase pattern  
**Related:** [ADR-005 Atomic graph transactions](../decisions/ADR-005-atomic-graph-transactions.md), [Scheduler, transactions, and concurrency](../architecture/03-scheduler-transactions-and-concurrency.md)

## Failure mode

You change a parent context (organisation, date, product family) and forget to clear one or more dependent contexts in the same commit. Observers briefly (or longer) see the new parent paired with the old child’s data.

Typical symptoms:

- Org switch shows the previous team’s services for a frame.
- Date switch keeps a slot selection that belongs to the old day.
- Configurator CPU change leaves an incompatible RAM value selected.

## Rule

Any context that is only meaningful under a parent value must be reset in the **same transaction** that changes the parent. Do not issue sequential top-level `setContext` calls for a cascade.

## Minimal correct shape

```ts
const SelectedOrgId = defineContextNode<string | null>({
  key: "selectedOrgId",
  initialValue: null,
});

const SelectedTeamId = defineContextNode<string | null>({
  key: "selectedTeamId",
  initialValue: null,
});

const SelectedEnv = defineContextNode<"prod" | "staging">({
  key: "selectedEnv",
  initialValue: "prod",
});

const Teams = defineDataNode({
  key: "teams",
  dependencies: [SelectedOrgId],
  initialValue: [] as Team[],
  load: ({ get, signal }) => {
    const orgId = get(SelectedOrgId);
    if (orgId == null) return [];
    return api.teams.list(orgId, { signal });
  },
});

const Services = defineDataNode({
  key: "services",
  dependencies: [SelectedOrgId, SelectedTeamId, SelectedEnv],
  initialValue: [] as Service[],
  load: ({ get, signal }) => {
    const orgId = get(SelectedOrgId);
    const teamId = get(SelectedTeamId);
    if (orgId == null || teamId == null) return [];
    return api.services.list({
      org: orgId,
      team: teamId,
      env: get(SelectedEnv),
      signal,
    });
  },
});

// Correct: one atomic cascade
async function selectOrganisation(runtime: GraphRuntime, orgId: string) {
  await runtime.transaction(async (tx) => {
    tx.setContext(SelectedOrgId, orgId);
    tx.setContext(SelectedTeamId, null);
    // Keep or reset env according to product rules; be explicit either way.
    // tx.setContext(SelectedEnv, "prod");
  });
}
```

After commit, the scheduler runs one invalidation and execution pass against the final staged contexts. Dependent data nodes see a consistent snapshot.

## Common wrong shapes

```ts
// Wrong: sequential top-level writes — observers can interleave
runtime.setContext(SelectedOrgId, orgId);
runtime.setContext(SelectedTeamId, null);

// Wrong: only clearing what the current component knows about
await runtime.transaction(async (tx) => {
  tx.setContext(SelectedOrgId, orgId);
  // forgot SelectedTeamId / selection ids owned by other panels
});
```

## Ownership guideline

Clear the dependent contexts that **your workflow owns**. If another feature owns a context that must also reset, either:

- include it in the same transaction (preferred when both features share the runtime), or
- publish a domain event and let that feature react with its own transaction.

Do not rely on “the next load will overwrite it” — the intermediate inconsistent state is already visible.

## Nested work

If cascade logic is split across helpers, pass the transaction handle so all stages share one session:

```ts
await runtime.transaction(async (tx) => {
  tx.setContext(SelectedOrgId, orgId);
  await clearTeamSelection(tx); // uses tx.setContext, not runtime.setContext
});
```

See ADR-005 for session ownership and composition rules.

## What this recipe does not own

- Product policy for *which* dependents must clear (always vs only when incompatible).
- Whether to preserve `SelectedEnv` across org changes.
- Multi-runtime coordination (each runtime has its own sessions).

## Checklist

- [ ] Parent change and dependent resets go through one `runtime.transaction`.
- [ ] Every context that is only meaningful under the parent is listed in that transaction.
- [ ] Data nodes that read those contexts list them in `dependencies`.
- [ ] UI reads `status` / `freshness` if it must distinguish “cleared, loading” from “still showing previous parent’s data”.
