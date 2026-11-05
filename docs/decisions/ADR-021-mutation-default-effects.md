# ADR-021: Mutation default effects

## Status

Accepted, implemented, and validated.

## Context

[ADR-013](./ADR-013-mutation-framework.md) kept `defineMutation` to the remote call (`key` + `execute`) and required `optimistic`, `onSuccess` and `classifyFailure` on every `runtime.mutate` call, so that shared remote command contracts never import page-specific graph nodes.

In practice most mutations behave the same way at every call site. Repeating the same three callbacks per call is boilerplate, invites drift between call sites, and is one of the larger concept-count costs for a new user, who must learn that the effects live somewhere other than the thing that looks like the whole mutation.

## Decision

`defineMutation` accepts optional `optimistic`, `onSuccess` and `classifyFailure`, with the same types and meaning as `MutationOptions`. They are defaults for every call of that mutation.

Resolution is per field, at call time. A field supplied to `runtime.mutate` replaces the definition's value for that field, for that call only; the default and the replacement never both run. An unsupplied field, or one supplied as `undefined`, uses the default. The three `MutationOptions` fields accept `undefined` in their types, so conditional options such as `{ optimistic: enabled ? fn : undefined }` type-check. There is no merging of callback bodies and no special opt-out value: a call that wants no effect passes a no-op (`optimistic: () => {}`).

The definition stores supplied defaults on a frozen `defaults` property, present only when at least one was given, so a definition without defaults is shaped exactly as before. A supplied default that is not a function throws when the mutation is defined, matching the existing `execute` validation.

The stored defaults type is deliberately erased to `never` callback parameters. `defineMutation` has already checked the callbacks against the mutation's input and result types, and erasing them keeps `MutationDefinition` assignable exactly as it was before (a mutation whose result type is `never` stays assignable where a wider result is expected). `runtime.mutate` restores the typed view in one place.

Settlement, rollback, context protection, optimistic ownership and diagnostics are unchanged: they receive the resolved options and cannot tell where a field came from.

## Consequences

The common case shrinks to one definition and a bare `runtime.mutate(mutation, input)`. Call sites that differ still work, by overriding a single field.

A definition that carries defaults references graph nodes, which was ADR-013's concern. The option is additive and optional: shared remote contracts stay `execute`-only and keep supplying effects per call. The user guide and public API say so explicitly, and recipe 02 flags defaults that most call sites override as a smell.

Replacement, not composition, is intentional. Running a default and a call-site `onSuccess` together would make the effective behaviour depend on invisible ordering and would make it impossible to opt out of a default.

This is an additive API change. No existing call or definition changes behaviour.

## Validation

`tests/core/mutation-defaults.spec.ts` covers: definition shape with and without defaults; frozen defaults; non-function rejection for each field; defaults applied with no call options; call-site replacement of `optimistic` and of `onSuccess` (only one runs); per-field merge; `undefined` treated as unsupplied; no-op opt-out; a default `classifyFailure` producing a clean rollback; and an unclassified failure still being unknown-outcome. Fault injection (ignoring defaults; letting the default win over the call site) fails the suite.

## Alternatives considered

**Keep per-call only (ADR-013).** Preserves strict separation but leaves the boilerplate and the extra concept.

**Compose default and call-site callbacks.** Rejected: hidden ordering, and no way to opt out.

**Move effects to the definition only.** Rejected: call sites that genuinely differ would need duplicate definitions, and shared contracts would have to import graph nodes.
