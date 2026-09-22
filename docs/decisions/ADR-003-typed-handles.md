# ADR-003: Typed Handles Over String-Only Consumer APIs

## Status

Accepted, implemented, and validated.

## Context

A graph framework needs some identity for each node - at minimum for topology, diagnostics, and internal indexing. The simplest consumer API for a JavaScript-first library would let callers reference nodes by that same string key everywhere: `runtime.get("targets")`, `useNode("targets")`, `dependencies: ["jobSeekerId"]`. This requires no extra concept beyond the key itself.

A string-keyed consumer API loses the node's value type at every call site. A lookup like `runtime.get("targets")` can only return `unknown` (or require an explicit, unchecked generic parameter supplied by the caller) without a central, hand-maintained key-to-type registry that would have to be kept in sync by hand as nodes are added, renamed, or change shape. Typos in a key are not caught until the call fails at runtime, and a rename of a node's key requires finding every string reference across the codebase (no compiler assistance).

## Decision

A node definition returned by `defineContextNode(...)`, `defineDataNode(...)`, or `defineDerivedNode(...)` is itself the typed handle consumers pass around. Public APIs that reference a node - `get(...)` inside a loader or derivation, `dependencies: [...]`, `useNode(...)`, `runtime.execute([...])`, `runtime.setContext(...)` - accept these handles, not bare strings. `NodeValue<typeof Handle>` resolves to the node's actual value type through the handle's type parameters, so a consumer never supplies or narrows a type by hand.

The stable string key carried by each handle remains the identity used for topology, indexing, diagnostics, validation messages, and serialisation. Graph creation registers one canonical definition for each key. Runtime APIs resolve supported equivalent handles through that key, but they always operate on the canonical registered definition and its runtime state. APIs whose semantics depend on definition-owned behaviour, such as manual refresh invoking a node loader, require the canonical registered handle rather than accepting a separately constructed lookalike.

## Consequences

- Dependency access (`get(SomeHandle)`) and results are compiler-checked end to end; a node that does not exist, or is not declared as a dependency, is a compile error rather than a runtime `undefined`.
- Renaming a node's variable is a normal, compiler-assisted refactor. Renaming a node's *key* is a separate, deliberate action (it affects diagnostics, topology, and any external reference to that key) and does not happen accidentally as a side effect of a handle rename.
- There is no central key-to-type registry to maintain by hand; the type lives on the handle itself.
- Consumers must import and hold a reference to the handle rather than a plain string, which is slightly more ceremony than `"targets"` but is the direct cost of the type safety above.
- Two independently constructed definitions that share a key remain distinct objects at the type level. Graph validation rejects registering both, and runtime operations never substitute an unregistered definition's loader, derivation, policy, or metadata for the canonical registered definition.

## Alternatives considered

### String-keyed lookup with a generic type parameter per call site

Rejected. `runtime.get<Target[]>("targets")` still requires the caller to supply and keep correct a type that the framework cannot verify, defeating the purpose - a stale or wrong type parameter compiles cleanly and fails silently at runtime.

### A central `Record<string, Type>` registry mapping keys to value types

Rejected. This reintroduces exactly the hand-maintained, easily-stale mapping the handle-based design avoids, and does not help at node-declaration or dependency-declaration sites, only at lookup sites.

### Class-based node definitions

Not required. Plain factory functions returning frozen typed objects give the same typed-handle property without introducing class identity, inheritance, or `instanceof` semantics that the rest of the framework does not otherwise need.
