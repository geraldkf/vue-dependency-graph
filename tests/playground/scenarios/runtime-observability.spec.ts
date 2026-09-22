import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import RuntimeObservabilityScenario from "../../../src/playground/scenarios/RuntimeObservabilityScenario.vue";
import { createRuntimeObservabilityScenario } from "../../../src/playground/scenarios/runtime-observability-model";

describe("RuntimeObservabilityScenario", () => {
  it("shows deterministic events, metrics, and a redacted snapshot for each control", async () => {
    render(RuntimeObservabilityScenario);

    await waitFor(() => {
      expect(screen.getByTestId("observability-summary").textContent).toContain(
        "Summary for case-100",
      );
    });

    await fireEvent.click(screen.getByRole("button", { name: "Change context" }));
    await waitFor(() => {
      expect(screen.getByTestId("observability-case").textContent).toContain("case-200");
      expect(screen.getByTestId("observability-outcome").textContent).toContain("context changed");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(screen.getByTestId("observability-outcome").textContent).toContain("explicit refresh");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Fail next request" }));
    await waitFor(() => {
      expect(screen.getByTestId("observability-outcome").textContent).toContain("request failed");
      expect(screen.getByTestId("observability-timeline").textContent).toContain(
        "node.load.failed",
      );
    });

    await fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => {
      expect(screen.getByTestId("observability-outcome").textContent).toContain(
        "request recovered",
      );
    });

    await fireEvent.click(screen.getByRole("button", { name: "Run transaction rollback" }));
    await waitFor(() => {
      expect(screen.getByTestId("observability-rollback-count").textContent).toContain("1");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Run mutation" }));
    await waitFor(() => {
      expect(screen.getByTestId("observability-mutation-count").textContent).toContain("1");
    });
    expect(screen.getByTestId("observability-snapshot").textContent).toContain(
      '"status": "omitted"',
    );
    expect(screen.getByTestId("observability-snapshot").textContent).not.toContain("secret-token");
  });

  it("reset creates a clean dedicated runtime, event stream, and metrics baseline", async () => {
    render(RuntimeObservabilityScenario);
    await waitFor(() => {
      expect(screen.getByTestId("observability-summary").textContent).toContain(
        "Summary for case-100",
      );
    });

    await fireEvent.click(screen.getByRole("button", { name: "Run mutation" }));
    await waitFor(() => {
      expect(screen.getByTestId("observability-mutation-count").textContent).toContain("1");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("observability-case").textContent).toContain("case-100");
      expect(screen.getByTestId("observability-mutation-count").textContent).toContain("0");
      expect(screen.getByTestId("observability-outcome").textContent).toContain("reset");
      expect(screen.getByTestId("observability-snapshot").textContent).toContain(
        '"runtimeId": "runtime"',
      );
    });
  });

  it("dispose releases the dedicated runtime subscription", async () => {
    const scenario = createRuntimeObservabilityScenario();
    await scenario.runtime.whenSettled();

    const before = scenario.runtime.createDiagnosticSnapshot().subscriptions;
    expect(before.find((item) => item.key === "observability.summary")?.direct).toBe(1);

    scenario.dispose();

    const after = scenario.runtime.createDiagnosticSnapshot().subscriptions;
    expect(after.find((item) => item.key === "observability.summary")?.direct).toBe(0);
    expect(after.find((item) => item.key === "observability.selected-case")?.required).toBe(0);
    expect(after.find((item) => item.key === "observability.protected-token")?.required).toBe(0);
  });
});
