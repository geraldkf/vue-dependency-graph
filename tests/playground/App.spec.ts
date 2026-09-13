import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/playground/App.vue";
import { useDependencyGraphStore } from "../../src/playground/dependency-graph-store";
import { metricA, metricB, metricC } from "../../src/playground/scenarios/aggregate-query-nodes";
import { sharedResource } from "../../src/playground/scenarios/concurrent-consumers-nodes";
import {
  selectedUserId,
  userProfile,
} from "../../src/playground/scenarios/context-switching-nodes";
import { flakyResource } from "../../src/playground/scenarios/error-and-retry-nodes";
import { toggleableResource } from "../../src/playground/scenarios/unmount-cleanup-nodes";

describe("playground shell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts every scenario tab through the Pinia-owned runtime", async () => {
    const pinia = createPinia();

    render(App, {
      global: { plugins: [pinia] },
    });

    expect(
      screen.getByRole("heading", { name: "Vue Dependency Graph" })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Context Switching" })
    ).toBeTruthy();

    const tabs = [
      "Concurrent Consumers",
      "Error and Retry",
      "Unmount Cleanup",
      "Aggregate Query",
      "Context Switching",
    ] as const;

    for (const tab of tabs) {
      await fireEvent.click(screen.getByRole("button", { name: tab }));
      expect(screen.getByRole("heading", { name: tab })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: tab }).getAttribute("aria-pressed")
      ).toBe("true");
    }
  });

  it("releases the previous scenario subscriptions when tabs change", async () => {
    const pinia = createPinia();
    const { runtime } = useDependencyGraphStore(pinia);

    render(App, {
      global: { plugins: [pinia] },
    });

    expect(runtime.getSubscriptionState(selectedUserId).direct).toBe(1);
    expect(runtime.getSubscriptionState(userProfile).direct).toBe(1);

    await fireEvent.click(
      screen.getByRole("button", { name: "Concurrent Consumers" })
    );

    expect(runtime.getSubscriptionState(selectedUserId).direct).toBe(0);
    expect(runtime.getSubscriptionState(userProfile).direct).toBe(0);
    expect(runtime.getSubscriptionState(sharedResource).direct).toBe(2);

    await fireEvent.click(
      screen.getByRole("button", { name: "Error and Retry" })
    );

    expect(runtime.getSubscriptionState(sharedResource).direct).toBe(0);
    expect(runtime.getSubscriptionState(flakyResource).direct).toBe(1);

    await fireEvent.click(
      screen.getByRole("button", { name: "Unmount Cleanup" })
    );

    expect(runtime.getSubscriptionState(flakyResource).direct).toBe(0);
    expect(runtime.getSubscriptionState(toggleableResource).direct).toBe(1);

    await fireEvent.click(
      screen.getByRole("button", { name: "Aggregate Query" })
    );

    expect(runtime.getSubscriptionState(toggleableResource).direct).toBe(0);
    expect(runtime.getSubscriptionState(metricA).direct).toBe(1);
    expect(runtime.getSubscriptionState(metricB).direct).toBe(1);
    expect(runtime.getSubscriptionState(metricC).direct).toBe(1);

    await fireEvent.click(
      screen.getByRole("button", { name: "Context Switching" })
    );

    expect(runtime.getSubscriptionState(metricA).direct).toBe(0);
    expect(runtime.getSubscriptionState(metricB).direct).toBe(0);
    expect(runtime.getSubscriptionState(metricC).direct).toBe(0);
    expect(runtime.getSubscriptionState(selectedUserId).direct).toBe(1);
    expect(runtime.getSubscriptionState(userProfile).direct).toBe(1);
  });
});
