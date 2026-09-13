import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import { createGraph, createGraphRuntime } from "../../../src/core";
import { createGraphRuntimePlugin } from "../../../src/vue/plugin";
import ContextSwitchingScenario from "../../../src/playground/scenarios/ContextSwitchingScenario.vue";
import {
  selectedUserId,
  userProfile,
} from "../../../src/playground/scenarios/context-switching-nodes";

describe("ContextSwitchingScenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the initial user's profile and switches users on click", async () => {
    const runtime = createGraphRuntime(
      createGraph({ nodes: [selectedUserId, userProfile] })
    );

    render(ContextSwitchingScenario, {
      global: { plugins: [createGraphRuntimePlugin(runtime)] },
    });

    expect(screen.getByTestId("status").textContent).toContain("idle");

    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByTestId("status").textContent).toContain("success");
    expect(screen.getByTestId("data").textContent).toContain(
      "Profile for user #1"
    );

    await fireEvent.click(screen.getByRole("button", { name: "User 2" }));
    await vi.advanceTimersByTimeAsync(600);

    expect(screen.getByTestId("status").textContent).toContain("success");
    expect(screen.getByTestId("data").textContent).toContain(
      "Profile for user #2"
    );
  });
});
