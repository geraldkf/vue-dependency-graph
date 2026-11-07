/**
 * Orders node keys by UTF-16 code unit, the same order as the default
 * `Array.prototype.sort()` and as graph cycle detection.
 *
 * Do not use `localeCompare` for ordering that the runtime exposes: its result
 * depends on the host's locale and ICU data, so the same graph could invalidate
 * siblings, or list metrics, in a different order on different machines, and it
 * is several times slower.
 */
export const compareKeys = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
