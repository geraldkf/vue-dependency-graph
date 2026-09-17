import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import TransactionIsolationScenario from "../../../src/playground/scenarios/TransactionIsolationScenario.vue";

const renderScenario = () => render(TransactionIsolationScenario);

const startIndependent = async (): Promise<void> => {
  await fireEvent.click(
    screen.getByRole("button", { name: "Start independent transactions" }),
  );
  await waitFor(() => {
    expect(screen.getByTestId("transaction-isolation-a-phase").textContent)
      .toContain("open");
    expect(screen.getByTestId("transaction-isolation-b-phase").textContent)
      .toContain("open");
  });
};

afterEach(() => cleanup());

describe("TransactionIsolationScenario", () => {
  it("commits independent sessions in either completion order", async () => {
    renderScenario();
    await startIndependent();

    await fireEvent.click(screen.getByRole("button", { name: "Commit operation B" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-isolation-b-phase").textContent)
        .toContain("committed");
      expect(screen.getByTestId("transaction-isolation-b-value").textContent)
        .toContain("20");
      expect(screen.getByTestId("transaction-isolation-b-requests").textContent)
        .toContain("1");
    });
    expect(screen.getByTestId("transaction-isolation-a-phase").textContent)
      .toContain("open");
    expect(screen.getByTestId("transaction-isolation-a-value").textContent)
      .toContain("1");
    expect(screen.getByTestId("transaction-isolation-scheduler").textContent)
      .toContain("idle");

    await fireEvent.click(screen.getByRole("button", { name: "Commit operation A" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-isolation-a-phase").textContent)
        .toContain("committed");
      expect(screen.getByTestId("transaction-isolation-a-value").textContent)
        .toContain("2");
      expect(screen.getByTestId("transaction-isolation-a-requests").textContent)
        .toContain("1");
    });
  });

  it("keeps one session's rollback independent from another session's commit", async () => {
    renderScenario();
    await startIndependent();

    await fireEvent.click(screen.getByRole("button", { name: "Rollback operation A" }));
    await fireEvent.click(screen.getByRole("button", { name: "Commit operation B" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-isolation-a-phase").textContent)
        .toContain("rolled-back");
      expect(screen.getByTestId("transaction-isolation-a-value").textContent)
        .toContain("1");
      expect(screen.getByTestId("transaction-isolation-b-phase").textContent)
        .toContain("committed");
      expect(screen.getByTestId("transaction-isolation-b-value").textContent)
        .toContain("20");
    });
  });

  it("reports a same-context conflict without applying the losing session's work", async () => {
    renderScenario();
    await fireEvent.click(
      screen.getByRole("button", { name: "Start shared-context conflict" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("transaction-isolation-a-phase").textContent)
        .toContain("open");
      expect(screen.getByTestId("transaction-isolation-b-phase").textContent)
        .toContain("open");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Commit operation B" }));
    await waitFor(() => {
      expect(screen.getByTestId("transaction-isolation-b-phase").textContent)
        .toContain("committed");
      expect(screen.getByTestId("transaction-isolation-shared").textContent)
        .toContain("300");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Commit operation A" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-isolation-a-phase").textContent)
        .toContain("conflicted");
      expect(screen.getByTestId("transaction-isolation-shared").textContent)
        .toContain("300");
      expect(screen.getByTestId("transaction-isolation-a-value").textContent)
        .toContain("1");
      expect(screen.getByTestId("transaction-isolation-b-value").textContent)
        .toContain("20");
      expect(screen.getByTestId("transaction-isolation-conflict").textContent)
        .toContain("transaction-isolation.shared");
    });
  });

  it("shows causal diagnostics for committed and rolled-back sessions", async () => {
    renderScenario();
    await startIndependent();

    await fireEvent.click(screen.getByRole("button", { name: "Commit operation B" }));
    await fireEvent.click(screen.getByRole("button", { name: "Rollback operation A" }));

    await waitFor(() => {
      const timeline = screen.getByTestId("transaction-isolation-timeline").textContent;
      expect(timeline).toContain("transaction.committed");
      expect(timeline).toContain("transaction.rolled-back");
      expect(timeline).toContain("scheduler.started");
      expect(timeline).toContain("node.load.started");
      expect(timeline).toContain("caused by");
    });
  });

  it("resets values, phases, counters, conflict details, and diagnostics", async () => {
    renderScenario();
    await startIndependent();
    await fireEvent.click(screen.getByRole("button", { name: "Commit operation A" }));
    await fireEvent.click(screen.getByRole("button", { name: "Rollback operation B" }));

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("transaction-isolation-a-phase").textContent)
        .toContain("idle");
      expect(screen.getByTestId("transaction-isolation-b-phase").textContent)
        .toContain("idle");
      expect(screen.getByTestId("transaction-isolation-a-value").textContent)
        .toContain("1");
      expect(screen.getByTestId("transaction-isolation-b-value").textContent)
        .toContain("10");
      expect(screen.getByTestId("transaction-isolation-shared").textContent)
        .toContain("100");
      expect(screen.getByTestId("transaction-isolation-a-requests").textContent)
        .toContain("0");
      expect(screen.getByTestId("transaction-isolation-b-requests").textContent)
        .toContain("0");
      expect(screen.getByTestId("transaction-isolation-conflict").textContent)
        .toContain("none");
      expect(screen.getByTestId("transaction-isolation-timeline").textContent)
        .toBe("");
    });
  });

  it("releases open sessions when unmounted", async () => {
    const rendered = renderScenario();
    await startIndependent();

    expect(() => rendered.unmount()).not.toThrow();
    await Promise.resolve();
  });
});
