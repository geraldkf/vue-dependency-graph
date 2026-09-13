import { ref, type Ref } from "vue";

export interface MockLoaderOptions {
  readonly delayMs?: number;
  readonly initialShouldFail?: boolean;
}

export interface MockLoader {
  /**
   * Visible in-UI call counter. Every scenario built on this loader can
   * render it directly, so dedup (or its absence) is something you see
   * by watching a number, not something you have to open devtools to
   * check.
   */
  readonly callCount: Ref<number>;
  /**
   * Toggle to make the next (and every subsequent, until toggled back)
   * load reject instead of resolve.
   */
  readonly shouldFail: Ref<boolean>;
  /**
   * Artificial delay so loading states are actually reachable by hand
   * instead of resolving before anyone watching can see them.
   */
  readonly delayMs: Ref<number>;
  /**
   * Wraps `produce` with the shared delay/failure/call-count behaviour.
   * The loader itself never decides what value a load resolves to —
   * `produce` supplies that — so every scenario can use one loader shape
   * while still computing genuinely different values.
   */
  readonly load: <TValue>(produce: () => TValue) => Promise<TValue>;
}

export const createMockLoader = (options?: MockLoaderOptions): MockLoader => {
  const callCount = ref(0);
  const shouldFail = ref(options?.initialShouldFail ?? false);
  const delayMs = ref(options?.delayMs ?? 600);

  const load = async <TValue>(produce: () => TValue): Promise<TValue> => {
    callCount.value += 1;
    await new Promise<void>(resolve => setTimeout(resolve, delayMs.value));
    if (shouldFail.value) {
      throw new Error("Mock loader failure (toggled on)");
    }
    return produce();
  };

  return { callCount, shouldFail, delayMs, load };
};
