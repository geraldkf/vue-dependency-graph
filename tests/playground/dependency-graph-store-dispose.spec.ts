import { createPinia, disposePinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent } from "vue";
import type { GraphRuntime } from "../../src/core";
import { useDependencyGraphStore } from "../../src/playground/dependency-graph-store";

// Wrap each runtime the store creates so its `dispose` can be observed.
// Everything else on the runtime is the real implementation.
const created = vi.hoisted(() => [] as GraphRuntime[]);

vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return {
    ...actual,
    createGraphRuntime: (...args: Parameters<typeof actual.createGraphRuntime>) => {
      const runtime = actual.createGraphRuntime(...args);
      const wrapped = {
        ...runtime,
        dispose: vi.fn(() => runtime.dispose()),
      } as GraphRuntime;
      created.push(wrapped);
      return wrapped;
    },
  };
});

const disposeCalls = (runtime: GraphRuntime): number =>
  (runtime.dispose as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

describe("dependency graph store disposal", () => {
  beforeEach(() => {
    created.length = 0;
    setActivePinia(createPinia());
  });

  it("does not dispose the runtime while the store is alive", () => {
    const store = useDependencyGraphStore();

    expect(created).toHaveLength(1);
    expect(disposeCalls(store.runtime)).toBe(0);
  });

  it("disposes the runtime when the store is disposed", () => {
    const store = useDependencyGraphStore();
    const runtime = store.runtime;

    store.$dispose();

    expect(disposeCalls(runtime)).toBe(1);
  });

  it("disposes the runtime when its Pinia instance is disposed", () => {
    const pinia = createPinia();
    const store = useDependencyGraphStore(pinia);
    const runtime = store.runtime;

    disposePinia(pinia);

    expect(disposeCalls(runtime)).toBe(1);
  });

  it("only disposes the runtime owned by the disposed Pinia instance", () => {
    const firstPinia = createPinia();
    const secondPinia = createPinia();
    const first = useDependencyGraphStore(firstPinia).runtime;
    const second = useDependencyGraphStore(secondPinia).runtime;

    disposePinia(firstPinia);

    expect(disposeCalls(first)).toBe(1);
    expect(disposeCalls(second)).toBe(0);
  });

  it("creates a fresh, undisposed runtime after the store is disposed", () => {
    const pinia = createPinia();
    const first = useDependencyGraphStore(pinia);
    const firstRuntime = first.runtime;
    first.$dispose();

    const second = useDependencyGraphStore(pinia);

    expect(second.runtime).not.toBe(firstRuntime);
    expect(disposeCalls(second.runtime)).toBe(0);
  });

  it("disposes the runtime when the app unmounts, using the playground's main.ts wiring", () => {
    const app = createApp(defineComponent({ setup: () => () => null }));
    const pinia = createPinia();
    app.use(pinia);
    app.onUnmount(() => disposePinia(pinia));
    const runtime = useDependencyGraphStore(pinia).runtime;
    app.mount(document.createElement("div"));
    expect(disposeCalls(runtime)).toBe(0);

    app.unmount();

    expect(disposeCalls(runtime)).toBe(1);
  });
});
