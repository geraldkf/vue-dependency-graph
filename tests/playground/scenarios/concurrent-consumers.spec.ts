import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/vue";
import { createGraph, createGraphRuntime } from "../../../src/core";
import { createGraphRuntimePlugin } from "../../../src/vue/plugin";
import ConcurrentConsumersScenario from "../../../src/playground/scenarios/ConcurrentConsumersScenario.vue";
import {
  sharedResource,
  sharedResourceLoader,
} from "../../../src/playground/scenarios/concurrent-consumers-nodes";

describe("ConcurrentConsumersScenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounting two independent consumers of the same node causes one load", async () => {
    const runtime = createGraphRuntime(
      createGraph({ nodes: [sharedResource] })
    );

    render(ConcurrentConsumersScenario, {
      global: { plugins: [createGraphRuntimePlugin(runtime)] },
    });

    // Two independent components, two independent subscriptions — this is
    // a Vue-layer check that neither ConsumerPanel instance accidentally
    // shares its subscription with the other.
    expect(runtime.getSubscriptionState(sharedResource).direct).toBe(2);

    await vi.advanceTimersByTimeAsync(600);

    expect(screen.getByTestId("status-A").textContent).toContain("success");
    expect(screen.getByTestId("status-B").textContent).toContain("success");
    expect(screen.getByTestId("data-A").textContent).toContain(
      "Shared resource data"
    );
    expect(screen.getByTestId("data-B").textContent).toContain(
      "Shared resource data"
    );

    // The actual point of this scenario: despite two independent
    // consumers, the underlying load happened once. This is a Vue-layer
    // check that useNode doesn't accidentally break the core's existing
    // execution dedup — not a re-test of the dedup mechanism itself,
    // which already has its own core-level tests.
    expect(sharedResourceLoader.callCount.value).toBe(1);
    expect(screen.getByTestId("call-count").textContent).toContain("1");
  });
});
