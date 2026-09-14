import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import AtomicTransactionScenario from "../../../src/playground/scenarios/AtomicTransactionScenario.vue";

describe("AtomicTransactionScenario", () => {
  it("does not expose intermediate related context values", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Start transaction" })
    );

    expect(screen.getByTestId("transaction-state").textContent).toContain("open");
    expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");
    expect(screen.getByTestId("combined-value").textContent).toContain("11");
    expect(screen.getByTestId("observer-snapshots").textContent).not.toContain(
      "2 + 10"
    );

    await fireEvent.click(
      screen.getByRole("button", { name: "Complete transaction" })
    );

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "committed"
      );
      expect(screen.getByTestId("committed-values").textContent).toContain(
        "2 + 20"
      );
      expect(screen.getByTestId("combined-value").textContent).toContain("22");
    });

    expect(screen.getByTestId("observer-snapshots").textContent).toContain(
      "2 + 20"
    );
    expect(screen.getByTestId("observer-snapshots").textContent).not.toContain(
      "2 + 10"
    );
    expect(screen.getByTestId("observer-snapshots").textContent).not.toContain(
      "1 + 20"
    );
  });
});
