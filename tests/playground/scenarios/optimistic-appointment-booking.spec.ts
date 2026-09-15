import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OptimisticAppointmentBookingScenario from "../../../src/playground/scenarios/OptimisticAppointmentBookingScenario.vue";
import { useDependencyGraphStore } from "../../../src/playground/dependency-graph-store";
import {
  optimisticAppointmentApi,
  optimisticAppointments,
} from "../../../src/playground/scenarios/optimistic-appointment-nodes";
import {
  capabilityInterviewStatus,
  capabilityStatusLoader,
} from "../../../src/playground/scenarios/typed-events-nodes";

const renderScenario = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  return {
    rendered: render(OptimisticAppointmentBookingScenario, {
      global: { plugins: [pinia] },
    }),
    runtime: useDependencyGraphStore().runtime,
  };
};

const waitForReady = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByText("confirmed-1: confirmed")).toBeTruthy();
    expect(
      screen.getByTestId("optimistic-booking-capability-requests").textContent,
    ).toContain("1");
  });
};

describe("OptimisticAppointmentBookingScenario", () => {
  beforeEach(() => {
    optimisticAppointmentApi.releasePending();
    optimisticAppointmentApi.reset();
    capabilityStatusLoader.reset();
  });

  it("shows the optimistic appointment before manual completion", async () => {
    renderScenario();
    await waitForReady();

    await fireEvent.click(screen.getByRole("button", { name: "Start booking" }));

    await waitFor(() => {
      expect(screen.getByText("pending-1: pending")).toBeTruthy();
      expect(screen.getByTestId("optimistic-booking-phase").textContent).toContain(
        "optimistic",
      );
      expect(screen.getByTestId("optimistic-booking-requests").textContent).toContain(
        "1",
      );
    });
  });

  it("confirms the appointment and invalidates capability status after success", async () => {
    renderScenario();
    await waitForReady();

    await fireEvent.click(screen.getByRole("button", { name: "Start booking" }));
    await waitFor(() => expect(screen.getByText("pending-1: pending")).toBeTruthy());
    expect(
      screen.getByTestId("optimistic-booking-capability-requests").textContent,
    ).toContain("1");

    await fireEvent.click(screen.getByRole("button", { name: "Confirm success" }));

    await waitFor(() => {
      expect(screen.getByText("pending-1: confirmed")).toBeTruthy();
      expect(screen.getByTestId("optimistic-booking-phase").textContent).toContain(
        "confirmed",
      );
      expect(
        screen.getByTestId("optimistic-booking-capability-requests").textContent,
      ).toContain("2");
    });
  });

  it("restores the previous appointment list after known rejection", async () => {
    renderScenario();
    await waitForReady();

    await fireEvent.click(screen.getByRole("button", { name: "Start booking" }));
    await waitFor(() => expect(screen.getByText("pending-1: pending")).toBeTruthy());
    await fireEvent.click(screen.getByRole("button", { name: "Reject booking" }));

    await waitFor(() => {
      expect(screen.queryByText("pending-1: pending")).toBeNull();
      expect(screen.getByTestId("optimistic-booking-phase").textContent).toContain(
        "rolled-back",
      );
      expect(screen.getByTestId("optimistic-booking-outcome").textContent).toContain(
        "rejected and rolled back",
      );
    });
    expect(
      screen.getByTestId("optimistic-booking-capability-requests").textContent,
    ).toContain("1");
  });

  it("shows an unknown outcome and requests authoritative reconciliation", async () => {
    const { runtime } = renderScenario();
    await waitForReady();

    await fireEvent.click(screen.getByRole("button", { name: "Start booking" }));
    await waitFor(() => expect(screen.getByText("pending-1: pending")).toBeTruthy());
    await fireEvent.click(
      screen.getByRole("button", { name: "Make outcome unknown" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("optimistic-booking-phase").textContent).toContain(
        "unknown",
      );
      expect(screen.getByTestId("optimistic-booking-outcome").textContent).toContain(
        "authoritative reload requested",
      );
      expect(runtime.getState(optimisticAppointments).freshness).toBe("fresh");
      expect(screen.queryByText("pending-1: pending")).toBeNull();
    });
  });

  it("rejects an overlapping optimistic booking before a second request starts", async () => {
    renderScenario();
    await waitForReady();

    await fireEvent.click(screen.getByRole("button", { name: "Start booking" }));
    await waitFor(() => expect(screen.getByText("pending-1: pending")).toBeTruthy());
    await fireEvent.click(
      screen.getByRole("button", { name: "Start overlapping booking" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("optimistic-booking-outcome").textContent).toContain(
        "overlapping booking rejected",
      );
    });
    expect(screen.getByTestId("optimistic-booking-requests").textContent).toContain(
      "1",
    );
    expect(screen.getByTestId("optimistic-booking-phase").textContent).toContain(
      "optimistic",
    );
  });

  it("resets appointments, counters, and outcome deterministically", async () => {
    renderScenario();
    await waitForReady();
    await fireEvent.click(screen.getByRole("button", { name: "Start booking" }));
    await waitFor(() => expect(screen.getByText("pending-1: pending")).toBeTruthy());

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.queryByText("pending-1: pending")).toBeNull();
      expect(screen.getByText("confirmed-1: confirmed")).toBeTruthy();
      expect(screen.getByTestId("optimistic-booking-phase").textContent).toContain(
        "ready",
      );
      expect(screen.getByTestId("optimistic-booking-requests").textContent).toContain(
        "0",
      );
      expect(
        screen.getByTestId("optimistic-booking-capability-requests").textContent,
      ).toContain("1");
    });
  });

  it("releases a pending scenario on unmount without Vue warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rendered } = renderScenario();
    await waitForReady();
    await fireEvent.click(screen.getByRole("button", { name: "Start booking" }));
    await waitFor(() => expect(screen.getByText("pending-1: pending")).toBeTruthy());

    rendered.unmount();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
