# ADR-023: Locale-independent key ordering

## Status

Accepted, implemented, and validated.

## Context

Two places ordered node keys with `String.prototype.localeCompare`: the children of each node when a graph is created, and the per-node entries of a metrics snapshot. Everywhere else the runtime orders keys with the default code-unit sort, including cycle detection, which says explicitly that it is independent of locale, and the devtools layout.

`localeCompare` with no locale argument uses the host's default locale and ICU data. The same graph could therefore order the same siblings differently on different machines. Because children are walked to invalidate descendants and to notify, that order reaches invalidation order, diagnostic event order and metrics output. Two users running the same application could see different orderings of events that happen to be siblings, which makes diagnostics harder to compare and makes a failing ordering hard to reproduce. For example, `["B", "a", "_x", "1", "ä", "z"]` sorts three different ways under the `en` locale, the `sv` locale, and code-unit order.

It was also the only dependence on ICU in the core. The first use in a process initializes a collator. In isolation, the first sort of 50,000 keys took about 160 ms against about 21 ms once warm; in a fresh process, creating a graph with a 20,000-child fan-out was about 9 ms faster after this change. The cost is real but small and one-time, and is not the reason for the change.

## Decision

Keys are ordered by UTF-16 code unit, through one shared function (`compareKeys`), in both places. That is the same order the default sort gives, and the one the rest of the runtime already used. The rule is documented on the function: ordering the runtime exposes must not consult the locale.

## Consequences

Sibling order is now the same on every machine and runtime. This is a behavior change for keys where the old order differed from code-unit order, which means keys that mix upper and lower case, or punctuation, digits and letters in ways ICU collates differently. With code-unit order, uppercase sorts before lowercase and `_` sorts between them. Applications that never depended on the relative order of invalidation or notification among sibling nodes are not affected. The documented guarantee is unchanged: children are sorted by key.

Warm sorting cost is nearly identical, so this is not a throughput change. It removes the one-time collator initialization and, more importantly, the machine dependence.

## Validation

`tests/core/key-ordering.spec.ts` checks the comparator against the default sort, stubs `localeCompare` to throw during graph construction and sorting to prove it is not consulted, and checks the order of a node's children and of metrics entries, including when nodes are declared in reverse order.

## Alternatives considered

**Pin a locale (`localeCompare(b, "en")`).** Removes the host dependence but keeps the ICU cost and a second, different ordering rule from the rest of the runtime.

**Leave the order unspecified.** Rejected: the order is observable and already documented as deterministic.
