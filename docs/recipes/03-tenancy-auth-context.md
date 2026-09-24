# Recipe 03 — Tenancy and auth context checklist

**Status:** research-phase pattern  
**Related:** [ADR-003 Typed handles](../decisions/ADR-003-typed-handles.md), [Graph and node model](../architecture/02-graph-and-node-model.md)

## Failure mode

A data node loads with the wrong tenant, role, or permission scope because tenancy/auth was closed over, read from a global, or omitted from `dependencies`. Caching and subscription reuse then serve cross-tenant or over-privileged data until a full remount.

Typical symptoms:

- Switching organisation still shows the previous organisation’s records for some panels.
- A viewer with reduced permissions still hits an endpoint that returns full detail (client graph keeps an old value).
- Two nodes share a similar key shape but different tenants and the wrong one is read.

## Rule

Anything that **affects which rows a load may return** must be:

1. expressed as a context node (or a derived node of contexts), and  
2. listed in that data node’s `dependencies`.

The type system ensures you only `get` declared dependencies. It does **not** ensure you declared the tenancy dependency in the first place.

## Minimal correct shape

```ts
const ViewerOrgId = defineContextNode<string | null>({
  key: "viewerOrgId",
  initialValue: null,
});

const ViewerRole = defineContextNode<"admin" | "member" | "viewer">({
  key: "viewerRole",
  initialValue: "viewer",
});

/** Single scope node downstream features can depend on. */
const EffectiveScope = defineDerivedNode({
  key: "effectiveScope",
  dependencies: [ViewerOrgId, ViewerRole],
  derive: ({ get }) => ({
    orgId: get(ViewerOrgId),
    role: get(ViewerRole),
  }),
  initialValue: { orgId: null, role: "viewer" as const },
});

const Projects = defineDataNode({
  key: "projects",
  dependencies: [EffectiveScope],
  initialValue: [] as Project[],
  load: ({ get, signal }) => {
    const scope = get(EffectiveScope);
    if (scope.orgId == null) return [];
    return api.projects.list({
      orgId: scope.orgId,
      role: scope.role,
      signal,
    });
  },
});
```

On login / org switch, set tenancy contexts in one transaction (see [Recipe 01](./01-atomic-cascade.md)):

```ts
await runtime.transaction(async (tx) => {
  tx.setContext(ViewerOrgId, session.orgId);
  tx.setContext(ViewerRole, session.role);
  // clear feature selections that are org-scoped
});
```

## Prefer one EffectiveScope

Scattering `ViewerOrgId` into dozens of dependency lists works but is easy to miss on new nodes. A single derived `EffectiveScope` (or a small set of scope nodes) gives reviewers one place to check.

If some nodes need only `orgId` and others need `orgId + role`, either:

- depend on `EffectiveScope` everywhere (simple), or  
- keep both `ViewerOrgId` and `EffectiveScope` and document which nodes need which.

## Common wrong shapes

```ts
// Wrong: closed-over session — changes to org will not re-run load
load: ({ signal }) => api.projects.list({ orgId: currentSession.orgId, signal }),

// Wrong: reading a non-dependency (will not type-check if you use get correctly,
// but easy to bypass with external state)
load: ({ signal }) => api.projects.list({ orgId: store.orgId, signal }),

// Wrong: tenancy only applied in the UI filter after a broad load
load: () => api.projects.listAll(), // then filter by org in the component
```

## Auth tokens and headers

Tokens often live outside the graph (HTTP client interceptor). That is fine **if** the token does not change the *identity of the result set* independently of context nodes. When impersonation or “act as org” changes results, model that as context and list it in dependencies.

## Checklist

- [ ] Every data node whose result set depends on tenant or role lists those contexts (or `EffectiveScope`) in `dependencies`.
- [ ] Org/role switches go through a transaction that also clears org-scoped selections.
- [ ] No `load` closes over mutable session state instead of `get(...)`.
- [ ] New nodes are reviewed against this checklist in PR.
- [ ] Diagnostics/snapshots redact sensitive scope values if needed (`diagnostics.value`).

## What this recipe does not own

- Server-side authorisation (always enforce on the API).
- Token refresh plumbing.
- Whether Pinia or the graph holds the session blob — only that **graph loads** see tenancy via dependencies.
