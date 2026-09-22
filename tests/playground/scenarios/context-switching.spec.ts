import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import { useDependencyGraphStore } from "../../../src/playground/dependency-graph-store";
import ContextSwitchingScenario from "../../../src/playground/scenarios/ContextSwitchingScenario.vue";

describe("ContextSwitchingScenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the initial user's profile and switches users on click", async () => {
    const pinia = createPinia();
    useDependencyGraphStore(pinia);

    render(ContextSwitchingScenario, {
      global: { plugins: [pinia] },
    });

    expect(screen.getByTestId("status").textContent).toContain("idle");

    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByTestId("status").textContent).toContain("success");
    expect(screen.getByTestId("data").textContent).toContain("Profile for user #1");

    await fireEvent.click(screen.getByRole("button", { name: "User 2" }));
    await vi.advanceTimersByTimeAsync(600);

    expect(screen.getByTestId("status").textContent).toContain("success");
    expect(screen.getByTestId("data").textContent).toContain("Profile for user #2");
  });
});
