/**
 * Garbage-collection helpers for the retention tests.
 *
 * A value counts as "released" when nothing reachable still holds it, which is
 * what WeakRef + a forced collection can observe. `vitest.config.ts` starts the
 * test workers with `--expose-gc`; without it these helpers fail loudly rather
 * than skipping, because a silently skipped retention test proves nothing.
 *
 * Usage rules that make the checks reliable:
 * - create the value inside a function and return only a WeakRef, so no local
 *   in the test keeps it alive;
 * - always await between creating and checking (a WeakRef target stays alive
 *   for the rest of the synchronous turn that touched it);
 * - prove the harness itself with `expectRetained` on something that really is
 *   still referenced (see garbage-collection.spec.ts).
 */

const collect = (): void => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== "function") {
    throw new Error(
      "globalThis.gc is not available. Run the tests through vitest.config.ts, which starts workers with --expose-gc.",
    );
  }
  gc();
};

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const collectGarbage = async (rounds = 3): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) {
    collect();
    await nextMacrotask();
  }
};

/** A distinctive object big enough to be a realistic node value. */
export const makeValue = (
  label: string,
): { readonly label: string; readonly payload: number[] } => ({
  label,
  payload: new Array<number>(2_000).fill(1),
});

export const weakRefTo = <T extends object>(value: T): WeakRef<T> => new WeakRef(value);

export const expectCollected = async (ref: WeakRef<object>, description: string): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await collectGarbage();
    if (ref.deref() === undefined) return;
  }
  throw new Error(`${description} is still reachable after garbage collection`);
};

export const expectRetained = async (ref: WeakRef<object>, description: string): Promise<void> => {
  await collectGarbage(5);
  if (ref.deref() === undefined) {
    throw new Error(`${description} was collected but is expected to still be reachable`);
  }
};
