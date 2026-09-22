import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import DevtoolsScenario from "../../../src/playground/scenarios/DevtoolsScenario.vue";

describe("DevtoolsScenario", () => {
  it("shows the graph, updates on user change, and reflects a mutation and a failure", async () => {
    render(DevtoolsScenario);

    await waitFor(() => {
      expect(screen.getByTestId("gdt-graph-node-devtools-playground.appointments")).toBeTruthy();
    });

    await fireEvent.click(screen.getByTestId("devtools-change-user"));
    await waitFor(() => {
      expect(screen.getByTestId("devtools-last-action").textContent).toContain("user changed");
    });

    await fireEvent.click(screen.getByTestId("devtools-book-appointment"));
    await waitFor(() => {
      expect(screen.getByTestId("devtools-last-action").textContent).toContain(
        "appointment booked",
      );
    });

    await fireEvent.click(screen.getByTestId("devtools-fail-next"));
    await fireEvent.click(screen.getByTestId("devtools-change-user"));
    await waitFor(() => {
      expect(screen.getByTestId("gdt-graph-node-devtools-playground.appointments")).toBeTruthy();
    });

    await fireEvent.click(screen.getByTestId("gdt-tab-timeline"));
    expect(screen.getByTestId("gdt-timeline-list").textContent).toBeTruthy();
  });
});
