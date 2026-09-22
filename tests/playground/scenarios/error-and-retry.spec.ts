import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import { useDependencyGraphStore } from "../../../src/playground/dependency-graph-store";
import ErrorAndRetryScenario from "../../../src/playground/scenarios/ErrorAndRetryScenario.vue";
import {
  flakyLoader,
  flakyResource,
} from "../../../src/playground/scenarios/error-and-retry-nodes";

describe("ErrorAndRetryScenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // flakyLoader is a module-level singleton shared across scenario
    // instances — reset it explicitly rather than assume a fresh state,
    // since a previous test could have left it toggled on.
    flakyLoader.shouldFail.value = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an error with no data on initial load failure", async () => {
    flakyLoader.shouldFail.value = true;
    const pinia = createPinia();
    const { runtime } = useDependencyGraphStore(pinia);

    render(ErrorAndRetryScenario, {
      global: { plugins: [pinia] },
    });

    await vi.advanceTimersByTimeAsync(600);

    expect(screen.getByTestId("status").textContent).toContain("error");
    expect(screen.getByTestId("data").textContent).toContain("(none yet)");
    expect(screen.getByTestId("error").textContent).toContain("Mock loader failure");
  });

  it("keeps stale data visible alongside the error when a refresh fails, triggered via the UI toggle", async () => {
    const pinia = createPinia();
    const { runtime } = useDependencyGraphStore(pinia);

    render(ErrorAndRetryScenario, {
      global: { plugins: [pinia] },
    });

    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByTestId("status").textContent).toContain("success");
    expect(screen.getByTestId("data").textContent).toContain("Loaded successfully");

    // Toggle failure on through the actual checkbox, not by setting the
    // ref directly — this is the thing that proves the v-model wiring
    // genuinely works, not just that the underlying ref supports it
    // (already covered by V5A's own tests).
    await fireEvent.click(screen.getByLabelText("Make the next load fail"));
    expect(flakyLoader.shouldFail.value).toBe(true);

    await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await vi.advanceTimersByTimeAsync(600);

    expect(screen.getByTestId("status").textContent).toContain("error");
    expect(screen.getByTestId("error").textContent).toContain("Mock loader failure");
    // The actual point of this scenario: the previous successful data
    // stays visible even though the refresh failed.
    expect(screen.getByTestId("data").textContent).toContain("Loaded successfully");
  });
});
