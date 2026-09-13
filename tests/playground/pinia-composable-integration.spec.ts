import { render } from "@testing-library/vue";
import { createPinia } from "pinia";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDependencyGraphStore } from "../../src/playground/dependency-graph-store";
import {
  sharedResource,
  sharedResourceLoader,
} from "../../src/playground/scenarios/concurrent-consumers-nodes";
import {
  selectedUserId,
  userProfile,
} from "../../src/playground/scenarios/context-switching-nodes";
import { useNode, useNodes } from "../../src/vue";

describe("Pinia-owned runtime composable integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sharedResourceLoader.callCount.value = 0;
    sharedResourceLoader.shouldFail.value = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads through useNode without installing the graph runtime plugin", async () => {
    const pinia = createPinia();
    const graphStore = useDependencyGraphStore(pinia);

    const Probe = defineComponent({
      setup() {
        const store = useDependencyGraphStore();
        const profile = useNode(userProfile, { runtime: store.runtime });
        return () => `${profile.status.value}:${profile.data.value}`;
      },
    });

    const { getByText, unmount } = render(Probe, {
      global: { plugins: [pinia] },
    });

    expect(graphStore.runtime.getSubscriptionState(userProfile).direct).toBe(1);

    await vi.advanceTimersByTimeAsync(600);

    expect(getByText("success:Profile for user #1")).toBeTruthy();

    unmount();
    expect(graphStore.runtime.getSubscriptionState(userProfile).direct).toBe(0);
  });

  it("shares one execution across two Pinia-backed consumers", async () => {
    const pinia = createPinia();
    const graphStore = useDependencyGraphStore(pinia);

    const Consumer = defineComponent({
      setup() {
        const store = useDependencyGraphStore();
        const resource = useNode(sharedResource, { runtime: store.runtime });
        return () => resource.data.value;
      },
    });
    const Probe = defineComponent({
      components: { Consumer },
      template: "<div><Consumer /><Consumer /></div>",
    });

    render(Probe, {
      global: { plugins: [pinia] },
    });

    expect(
      graphStore.runtime.getSubscriptionState(sharedResource).direct
    ).toBe(2);

    await vi.advanceTimersByTimeAsync(600);

    expect(sharedResourceLoader.callCount.value).toBe(1);
  });

  it("uses the store runtime with useNodes and reacts to context changes", async () => {
    const pinia = createPinia();
    const graphStore = useDependencyGraphStore(pinia);
    let rendered = "";

    const Probe = defineComponent({
      setup() {
        const store = useDependencyGraphStore();
        const query = useNodes([selectedUserId, userProfile], {
          runtime: store.runtime,
        });
        return () => {
          rendered = `${query.results[0].value.data}:${query.results[1].value.data}`;
          return rendered;
        };
      },
    });

    const { getByText } = render(Probe, {
      global: { plugins: [pinia] },
    });

    await vi.advanceTimersByTimeAsync(600);
    expect(getByText("1:Profile for user #1")).toBeTruthy();

    graphStore.runtime.setContext(selectedUserId, 2);
    await vi.advanceTimersByTimeAsync(600);

    expect(getByText("2:Profile for user #2")).toBeTruthy();
  });
});
