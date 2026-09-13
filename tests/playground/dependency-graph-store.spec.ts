import { createPinia, setActivePinia } from "pinia";
import { isReactive } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import { useDependencyGraphStore } from "../../src/playground/dependency-graph-store";
import { selectedUserId } from "../../src/playground/scenarios/context-switching-nodes";

describe("dependency graph store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("returns one stable runtime for one Pinia instance", () => {
    const firstStore = useDependencyGraphStore();
    const secondStore = useDependencyGraphStore();

    expect(secondStore).toBe(firstStore);
    expect(secondStore.runtime).toBe(firstStore.runtime);
  });

  it("keeps the runtime outside Vue reactivity", () => {
    const store = useDependencyGraphStore();

    expect(isReactive(store.runtime)).toBe(false);
  });

  it("creates an independent runtime for each Pinia instance", () => {
    const firstStore = useDependencyGraphStore(createPinia());
    const secondStore = useDependencyGraphStore(createPinia());

    expect(secondStore.runtime).not.toBe(firstStore.runtime);

    firstStore.runtime.setContext(selectedUserId, 2);

    expect(firstStore.runtime.getState(selectedUserId).data).toBe(2);
    expect(secondStore.runtime.getState(selectedUserId).data).toBe(1);
  });
});
