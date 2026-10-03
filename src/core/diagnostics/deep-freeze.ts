/** Freeze the plain, acyclic value trees constructed by diagnostic snapshots. */
export const deepFreeze = <TValue>(value: TValue): TValue => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
};
