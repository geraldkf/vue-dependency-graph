import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import { useDependencyGraphStore } from "../../../src/playground/dependency-graph-store";
import UnmountCleanupScenario from "../../../src/playground/scenarios/UnmountCleanupScenario.vue";
import { toggleableResource } from "../../../src/playground/scenarios/unmount-cleanup-nodes";

describe("UnmountCleanupScenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the subscriber count drop to zero on hide and return on show", async () => {
    const pinia = createPinia();
    const { runtime } = useDependencyGraphStore(pinia);

    render(UnmountCleanupScenario, {
      global: { plugins: [pinia] },
    });

    // The subscription itself is already true synchronously (confirmed
    // directly: getSubscriptionState shows 1 immediately after render()),
    // but Vue batches the DOM update into the next tick — advancing fake
    // timers here flushes that, the same way fireEvent already did in
    // every other scenario test so far. Checking textContent before this
    // would be asserting on a DOM that hasn't caught up yet, not a bug in
    // the component.
    await vi.advanceTimersByTimeAsync(300);

    expect(screen.getByTestId("subscriber-count").textContent).toContain(
      "1"
    );
    expect(runtime.getSubscriptionState(toggleableResource).direct).toBe(1);
    expect(screen.getByTestId("toggleable-status").textContent).toContain(
      "success"
    );

    await fireEvent.click(
      screen.getByRole("button", { name: "Hide consumer" })
    );

    expect(screen.getByTestId("subscriber-count").textContent).toContain(
      "0"
    );
    expect(runtime.getSubscriptionState(toggleableResource).direct).toBe(0);
    // v-if actually removed the consumer, not just visually hid it —
    // this is the thing a unit test could miss if it only checked the
    // subscription count and never confirmed the DOM itself changed.
    expect(screen.queryByTestId("toggleable-status")).toBeNull();

    await fireEvent.click(
      screen.getByRole("button", { name: "Show consumer" })
    );

    expect(screen.getByTestId("subscriber-count").textContent).toContain(
      "1"
    );
    expect(runtime.getSubscriptionState(toggleableResource).direct).toBe(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByTestId("toggleable-status").textContent).toContain(
      "success"
    );
  });
});
