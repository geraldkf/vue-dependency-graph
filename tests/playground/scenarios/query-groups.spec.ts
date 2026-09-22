import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import QueryGroupsScenario from "../../../src/playground/scenarios/QueryGroupsScenario.vue";
import {
  queryGroupsAppointments,
  queryGroupsAppointmentsLoader,
  queryGroupsCapabilityLoader,
  queryGroupsCapabilityStatus,
} from "../../../src/playground/scenarios/query-groups-nodes";
import { useDependencyGraphStore } from "../../../src/playground/dependency-graph-store";

const renderScenario = () => {
  const pinia = createPinia();
  const rendered = render(QueryGroupsScenario, {
    global: { plugins: [pinia] },
  });
  const runtime = useDependencyGraphStore(pinia).runtime;
  return { runtime, ...rendered };
};

const completeLoads = async (): Promise<void> => {
  await vi.runAllTimersAsync();
  await Promise.resolve();
};

describe("Query Groups scenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryGroupsAppointmentsLoader.callCount.value = 0;
    queryGroupsAppointmentsLoader.delayMs.value = 600;
    queryGroupsAppointmentsLoader.shouldFail.value = false;
    queryGroupsCapabilityLoader.callCount.value = 0;
    queryGroupsCapabilityLoader.delayMs.value = 600;
    queryGroupsCapabilityLoader.shouldFail.value = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefetches without subscription ownership and mounts from fresh data", async () => {
    const { runtime } = renderScenario();

    await fireEvent.click(screen.getByRole("button", { name: "Prefetch page" }));
    await completeLoads();

    expect(screen.getByTestId("query-groups-prefetch-outcome").textContent).toContain("ready");
    expect(queryGroupsAppointmentsLoader.callCount.value).toBe(1);
    expect(queryGroupsCapabilityLoader.callCount.value).toBe(1);
    expect(runtime.getSubscriptionState(queryGroupsAppointments).direct).toBe(0);
    expect(runtime.getSubscriptionState(queryGroupsCapabilityStatus).direct).toBe(0);

    await fireEvent.click(screen.getByRole("button", { name: "Mount consumer" }));
    await runtime.whenSettled();

    expect(screen.getByTestId("query-groups-appointments").textContent).toContain(
      "Appointment 1 for 101",
    );
    expect(screen.getByTestId("query-groups-capability").textContent).toContain(
      "Capability request 1 for 101",
    );
    expect(screen.getByTestId("query-groups-aggregate").textContent).toContain("success: true");
    expect(queryGroupsAppointmentsLoader.callCount.value).toBe(1);
    expect(queryGroupsCapabilityLoader.callCount.value).toBe(1);
  });

  it("refreshes every refreshable query requirement through useQuery", async () => {
    const { runtime } = renderScenario();

    await fireEvent.click(screen.getByRole("button", { name: "Mount consumer" }));
    await completeLoads();
    await runtime.whenSettled();

    await fireEvent.click(screen.getByRole("button", { name: "Refresh page" }));
    await completeLoads();

    expect(queryGroupsAppointmentsLoader.callCount.value).toBe(2);
    expect(queryGroupsCapabilityLoader.callCount.value).toBe(2);
    expect(screen.getByTestId("query-groups-appointments").textContent).toContain(
      "Appointment 2 for 101",
    );
    expect(screen.getByTestId("query-groups-capability").textContent).toContain(
      "Capability request 2 for 101",
    );
    expect(screen.getByTestId("query-groups-refresh-outcome").textContent).toContain("ready");
  });

  it("releases all query subscription ownership when the consumer unmounts", async () => {
    const { runtime } = renderScenario();

    await fireEvent.click(screen.getByRole("button", { name: "Mount consumer" }));

    expect(runtime.getSubscriptionState(queryGroupsAppointments).direct).toBe(1);
    expect(runtime.getSubscriptionState(queryGroupsCapabilityStatus).direct).toBe(1);

    await fireEvent.click(screen.getByRole("button", { name: "Unmount consumer" }));

    expect(runtime.getSubscriptionState(queryGroupsAppointments).direct).toBe(0);
    expect(runtime.getSubscriptionState(queryGroupsCapabilityStatus).direct).toBe(0);
  });
});
