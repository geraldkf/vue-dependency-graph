import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import AtomicTransactionScenario from "../../../src/playground/scenarios/AtomicTransactionScenario.vue";

describe("AtomicTransactionScenario", () => {
  it("shows transaction progress separately from committed runtime state", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Start transaction" })
    );

    expect(screen.getByTestId("transaction-state").textContent).toContain(
      "first-staged"
    );
    expect(screen.getByTestId("committed-values").textContent).toContain(
      "1 + 10"
    );
    expect(screen.getByTestId("combined-value").textContent).toContain("11");
    expect(screen.getByTestId("in-progress-values").textContent).toContain(
      "2 + 10"
    );
    expect(screen.getByTestId("preview-result").textContent).toContain("12");
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");

    await fireEvent.click(
      screen.getByRole("button", { name: "Stage second value" })
    );

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "second-staged"
      );
      expect(screen.getByTestId("in-progress-values").textContent).toContain(
        "2 + 20"
      );
      expect(screen.getByTestId("preview-result").textContent).toContain("22");
    });
    expect(screen.getByTestId("committed-values").textContent).toContain(
      "1 + 10"
    );
    expect(screen.getByTestId("combined-value").textContent).toContain("11");
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");
  });

  it("commits both staged values without exposing an intermediate snapshot", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Start transaction" })
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Stage second value" })
    );
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "second-staged"
      );
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Commit transaction" })
    );

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "committed"
      );
      expect(screen.getByTestId("committed-values").textContent).toContain(
        "2 + 20"
      );
      expect(screen.getByTestId("combined-value").textContent).toContain("22");
      expect(screen.getByTestId("in-progress-values").textContent).toContain(
        "none"
      );
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

  it("rolls back both staged values when the transaction throws", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Start transaction" })
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Stage second value" })
    );
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "second-staged"
      );
      expect(screen.getByTestId("in-progress-values").textContent).toContain(
        "2 + 20"
      );
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Rollback with error" })
    );

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "rolled-back"
      );
      expect(screen.getByTestId("transaction-outcome").textContent).toContain(
        "rolled back"
      );
      expect(screen.getByRole("alert").textContent).toContain(
        "Playground transaction rollback"
      );
      expect(screen.getByTestId("in-progress-values").textContent).toContain(
        "none"
      );
    });

    expect(screen.getByTestId("committed-values").textContent).toContain(
      "1 + 10"
    );
    expect(screen.getByTestId("combined-value").textContent).toContain("11");
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");
  });

  it("releases either open transaction stage without post-unmount Vue warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { unmount } = render(AtomicTransactionScenario);

    await fireEvent.click(
      screen.getByRole("button", { name: "Start transaction" })
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Stage second value" })
    );
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "second-staged"
      );
    });

    unmount();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("resets committed state and clears rollback progress, outcome, and error", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Start transaction" })
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Stage second value" })
    );
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "second-staged"
      );
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Rollback with error" })
    );
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "rolled-back"
      );
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain(
        "idle"
      );
      expect(screen.getByTestId("transaction-outcome").textContent).toContain(
        "none"
      );
      expect(screen.getByTestId("committed-values").textContent).toContain(
        "1 + 10"
      );
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
      expect(screen.getByTestId("derive-count").textContent).toContain("0");
      expect(screen.getByTestId("in-progress-values").textContent).toContain(
        "none"
      );
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");
  });
});
