# Milestone 5H.4: Atomic Transaction Playground Lifecycle

## Status

Lifecycle hardening prepared. Offline automated and manual browser validation pending.

## Review findings

The Atomic Transaction scenario already released its awaited transaction gate during unmount, but the transaction continuation could still update the component's `transactionState` ref after unmount.

Reset also restored the two related context values through separate immediate writes. The observer history was cleared afterwards, so the UI normally hid the intermediate snapshot, but the reset path did not demonstrate the same atomic-update discipline as the scenario itself.

Both issues are small playground concerns rather than core runtime defects.

## Changes

### Unmount lifecycle

The scenario now tracks whether the component remains mounted.

During unmount it:

1. marks the component unmounted;
2. removes the runtime observer;
3. releases an open transaction gate;
4. clears the stored release callback.

When the released transaction later settles, its continuation clears internal transaction ownership but updates the Vue state only while the component remains mounted.

This avoids post-unmount reactive writes and ensures switching playground tabs cannot leave a suspended transaction behind.

### Atomic reset

Reset now restores both context values inside one runtime transaction:

```ts
await runtime.transaction(() => {
  runtime.setContext(firstValue, 1);
  runtime.setContext(secondValue, 10);
});
```

It then waits for scheduler settlement before clearing observer history, resetting the displayed derivation counter, and returning the scenario state to `idle`.

This makes reset behaviour consistent with the scenario's purpose and prevents an observer-visible partial reset pair.

## Tests

Extended `tests/playground/scenarios/atomic-transaction.spec.ts` to verify:

- unmount releases an open transaction;
- transaction settlement after unmount produces no Vue console warning or error;
- reset restores `1 + 10` atomically;
- reset restores the combined result to `11`;
- reset clears observer snapshots;
- reset clears the scenario derivation counter;
- reset returns transaction state to `idle`.

The existing test continues to prove that normal commit exposes only the coherent final pair.

## Documentation

The manual playground checklist now includes switching tabs while a transaction is open and confirms that returning to the scenario creates a clean dedicated runtime without a suspended transaction or warning.

## Scope

No core runtime source or public API changed.

## Validation completed in the contained environment

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Both passed. Full Vue type checking and component test execution remain offline responsibilities.

## Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Then complete the Atomic Transaction manual validation in `docs/PLAYGROUND.md`.
