/**
 * A small number of runtime controllers are genuinely forward-referenced:
 * they are read inside closures that are constructed before the controller
 * itself is assigned (see `runtime.ts`). A bare `let x!: T` hides that
 * hazard from readers and from the type checker. This wrapper keeps the
 * same forward-reference shape but makes it explicit and safe: reading
 * before assignment throws a clear error instead of returning `undefined`
 * silently typed as `T`.
 */
export interface LateBinding<T> {
  readonly get: () => T;
  readonly set: (value: T) => void;
}

export const createLateBinding = <T>(name: string): LateBinding<T> => {
  let value: T | undefined;
  let assigned = false;

  return Object.freeze({
    get: (): T => {
      if (!assigned) {
        throw new Error(
          `"${name}" was read before it was initialised. It must be assigned via set() before any wired callback can run.`,
        );
      }
      return value as T;
    },
    set: (next: T): void => {
      value = next;
      assigned = true;
    },
  });
};
