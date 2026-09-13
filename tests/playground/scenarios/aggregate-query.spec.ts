import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import { useDependencyGraphStore } from "../../../src/playground/dependency-graph-store";
import AggregateQueryScenario from "../../../src/playground/scenarios/AggregateQueryScenario.vue";
import {
  metricA,
  metricB,
  metricC,
  metricCLoader,
} from "../../../src/playground/scenarios/aggregate-query-nodes";

describe("AggregateQueryScenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    metricCLoader.shouldFail.value = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregate reflects full success when every metric loads", async () => {
    const pinia = createPinia();
    const { runtime } = useDependencyGraphStore(pinia);

    render(AggregateQueryScenario, {
      global: { plugins: [pinia] },
    });

    await vi.advanceTimersByTimeAsync(400);

    expect(screen.getByTestId("metric-a").textContent).toContain("success");
    expect(screen.getByTestId("metric-b").textContent).toContain("success");
    expect(screen.getByTestId("metric-c").textContent).toContain("success");
    expect(screen.getByTestId("aggregate-success").textContent).toContain(
      "true"
    );
    expect(screen.getByTestId("aggregate-error").textContent).toContain(
      "false"
    );
    expect(
      screen.getByTestId("aggregate-errors-count").textContent
    ).toContain("0");
  });

  it("aggregate reflects partial failure while the other metrics stay correct", async () => {
    const pinia = createPinia();
    const { runtime } = useDependencyGraphStore(pinia);

    render(AggregateQueryScenario, {
      global: { plugins: [pinia] },
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(screen.getByTestId("aggregate-success").textContent).toContain(
      "true"
    );

    await fireEvent.click(screen.getByLabelText("Make metric C fail"));
    expect(metricCLoader.shouldFail.value).toBe(true);

    await fireEvent.click(screen.getByRole("button", { name: "Reload all" }));
    await vi.advanceTimersByTimeAsync(400);

    // A and B are unaffected by C's failure toggle — the actual point of
    // this scenario is that the aggregate reflects a genuine mix, not an
    // all-or-nothing readout.
    expect(screen.getByTestId("metric-a").textContent).toContain("success");
    expect(screen.getByTestId("metric-a").textContent).toContain("42");
    expect(screen.getByTestId("metric-b").textContent).toContain("success");
    expect(screen.getByTestId("metric-b").textContent).toContain("17");
    expect(screen.getByTestId("metric-c").textContent).toContain("error");

    expect(screen.getByTestId("aggregate-loading").textContent).toContain(
      "false"
    );
    expect(screen.getByTestId("aggregate-error").textContent).toContain(
      "true"
    );
    // isSuccess is hasSuccessfulValue-based, not latest-attempt-based (see
    // execution.ts: a failed attempt never clears a prior success) — so
    // it stays true here, correctly, since all three metrics still have
    // displayable data. isSuccess and isError can both be true at once:
    // "there's data for everything" and "something's latest attempt
    // failed" are independent, simultaneously true statements.
    expect(screen.getByTestId("aggregate-success").textContent).toContain(
      "true"
    );
    expect(
      screen.getByTestId("aggregate-errors-count").textContent
    ).toContain("1");
  });

  it("isSuccess is false when a metric has never had a successful value", async () => {
    metricCLoader.shouldFail.value = true;
    const pinia = createPinia();
    const { runtime } = useDependencyGraphStore(pinia);

    render(AggregateQueryScenario, {
      global: { plugins: [pinia] },
    });

    await vi.advanceTimersByTimeAsync(400);

    // Distinct from the case above: here C has never succeeded even once,
    // so hasSuccessfulValue is genuinely false, and isSuccess correctly
    // reflects that — unlike the "stale success, fresh failure" case,
    // where isSuccess stays true.
    expect(screen.getByTestId("metric-c").textContent).toContain("error");
    expect(screen.getByTestId("aggregate-error").textContent).toContain(
      "true"
    );
    expect(screen.getByTestId("aggregate-success").textContent).toContain(
      "false"
    );
  });
});
