import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import AtomicTransactionScenario from "../../../src/playground/scenarios/AtomicTransactionScenario.vue";

describe("AtomicTransactionScenario", () => {
  it("shows transaction progress separately from committed runtime state", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));

    expect(screen.getByTestId("transaction-state").textContent).toContain("first-staged");
    expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");
    expect(screen.getByTestId("combined-value").textContent).toContain("11");
    expect(screen.getByTestId("in-progress-values").textContent).toContain("2 + 10");
    expect(screen.getByTestId("preview-result").textContent).toContain("12");
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");

    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
      expect(screen.getByTestId("in-progress-values").textContent).toContain("2 + 20");
      expect(screen.getByTestId("preview-result").textContent).toContain("22");
    });
    expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");
    expect(screen.getByTestId("combined-value").textContent).toContain("11");
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");
  });

  it("commits both staged values without exposing an intermediate snapshot", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Commit transaction" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("committed");
      expect(screen.getByTestId("committed-values").textContent).toContain("2 + 20");
      expect(screen.getByTestId("combined-value").textContent).toContain("22");
      expect(screen.getByTestId("in-progress-values").textContent).toContain("none");
    });

    expect(screen.getByTestId("observer-snapshots").textContent).toContain("2 + 20");
    expect(screen.getByTestId("observer-snapshots").textContent).not.toContain("2 + 10");
    expect(screen.getByTestId("observer-snapshots").textContent).not.toContain("1 + 20");
  });

  it("rolls back both staged values when the transaction throws", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
      expect(screen.getByTestId("in-progress-values").textContent).toContain("2 + 20");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Rollback with error" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("rolled-back");
      expect(screen.getByTestId("transaction-outcome").textContent).toContain("rolled back");
      expect(screen.getByRole("alert").textContent).toContain("Playground transaction rollback");
      expect(screen.getByTestId("in-progress-values").textContent).toContain("none");
    });

    expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");
    expect(screen.getByTestId("combined-value").textContent).toContain("11");
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");
  });

  it("releases either open transaction stage without post-unmount Vue warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { unmount } = render(AtomicTransactionScenario);

    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
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
    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Rollback with error" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("rolled-back");
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("idle");
      expect(screen.getByTestId("transaction-outcome").textContent).toContain("none");
      expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
      expect(screen.getByTestId("derive-count").textContent).toContain("0");
      expect(screen.getByTestId("in-progress-values").textContent).toContain("none");
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("observer-snapshots").textContent).toBe("");
  });
  it("applies unrelated runtime work before transaction closure and preserves it after rollback", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("unrelated-dependent-value").textContent).toContain("100");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    expect(screen.getByTestId("transaction-state").textContent).toContain("first-staged");

    await fireEvent.click(screen.getByRole("button", { name: "Apply unrelated runtime update" }));

    await waitFor(() => {
      expect(screen.getByTestId("unrelated-context-value").textContent).toContain("999");
      expect(screen.getByTestId("unrelated-dependent-value").textContent).toContain("999");
      expect(screen.getByTestId("unrelated-update-state").textContent).toContain(
        "committed while transaction open",
      );
    });
    expect(screen.getByTestId("transaction-state").textContent).toContain("first-staged");
    expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");

    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Rollback with error" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("rolled-back");
    });
    expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");
    expect(screen.getByTestId("unrelated-context-value").textContent).toContain("999");
    expect(screen.getByTestId("unrelated-dependent-value").textContent).toContain("999");
  });

  it("detects a same-context conflict and preserves the immediate value", async () => {
    render(AtomicTransactionScenario);

    await waitFor(() => {
      expect(screen.getByTestId("combined-value").textContent).toContain("11");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    await fireEvent.click(screen.getByRole("button", { name: "Apply conflicting runtime update" }));

    expect(screen.getByTestId("committed-values").textContent).toContain("999 + 10");
    expect(screen.getByTestId("conflict-state").textContent).toContain(
      "finish transaction to detect conflict",
    );

    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Commit transaction" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("conflicted");
      expect(screen.getByTestId("transaction-outcome").textContent).toContain("conflict rejected");
    });
    expect(screen.getByTestId("conflict-state").textContent).toContain("immediate value preserved");
    expect(screen.getByTestId("conflict-keys").textContent).toContain("atomic-transaction-first");
    expect(screen.getByTestId("committed-values").textContent).toContain("999 + 10");
    expect(screen.getByTestId("combined-value").textContent).toContain("1009");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reset clears the conflict demonstration and restores initial values", async () => {
    render(AtomicTransactionScenario);

    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    await fireEvent.click(screen.getByRole("button", { name: "Apply conflicting runtime update" }));
    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Commit transaction" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("conflicted");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("idle");
      expect(screen.getByTestId("committed-values").textContent).toContain("1 + 10");
      expect(screen.getByTestId("conflict-state").textContent).toContain("not demonstrated");
      expect(screen.getByTestId("conflict-keys").textContent).toContain("none");
    });
  });

  it("enables isolation actions only while the transaction is paused", async () => {
    render(AtomicTransactionScenario);

    const unrelatedButton = screen.getByRole("button", {
      name: "Apply unrelated runtime update",
    });
    const conflictButton = screen.getByRole("button", {
      name: "Apply conflicting runtime update",
    });

    expect(unrelatedButton).toHaveProperty("disabled", true);
    expect(conflictButton).toHaveProperty("disabled", true);

    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));

    expect(unrelatedButton).toHaveProperty("disabled", false);
    expect(conflictButton).toHaveProperty("disabled", false);

    await fireEvent.click(unrelatedButton);

    expect(unrelatedButton).toHaveProperty("disabled", true);
    expect(conflictButton).toHaveProperty("disabled", true);
  });

  it("does not expose a partial observer snapshot when conflict rejects staged work", async () => {
    render(AtomicTransactionScenario);

    await fireEvent.click(screen.getByRole("button", { name: "Start transaction" }));
    await fireEvent.click(screen.getByRole("button", { name: "Apply conflicting runtime update" }));
    await fireEvent.click(screen.getByRole("button", { name: "Stage second value" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("second-staged");
    });
    await fireEvent.click(screen.getByRole("button", { name: "Commit transaction" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-state").textContent).toContain("conflicted");
    });

    const snapshots = screen.getByTestId("observer-snapshots").textContent ?? "";
    expect(snapshots).toContain("999 + 10");
    expect(snapshots).not.toContain("2 + 20");
    expect(snapshots).not.toContain("999 + 20");
  });
});
