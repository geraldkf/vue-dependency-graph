import { cleanup, fireEvent, render, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import PollingProgressScenario from "../../../src/playground/scenarios/PollingProgressScenario.vue";

const text = (testId: string): string =>
  screen.getByTestId(testId).textContent ?? "";

const mountConsumer = async (): Promise<void> => {
  await fireEvent.click(screen.getByRole("button", { name: "Mount consumer" }));
};

describe("PollingProgressScenario", () => {
  afterEach(cleanup);

  it("advances deterministic progress without overlapping requests", async () => {
    render(PollingProgressScenario);
    await mountConsumer();

    expect(text("polling-operation")).toBe("operation-1");
    expect(text("polling-progress")).toBe("25%");
    expect(text("polling-request-count")).toBe("1");
    expect(text("polling-maximum-active")).toBe("1");

    await fireEvent.click(screen.getByRole("button", { name: "Advance one poll" }));

    expect(text("polling-progress")).toBe("50%");
    expect(text("polling-request-count")).toBe("2");
    expect(text("polling-maximum-active")).toBe("1");
    expect(text("polling-next-delay")).toBe("1000");
  });

  it("completes and stops polling", async () => {
    render(PollingProgressScenario);
    await mountConsumer();
    await fireEvent.click(screen.getByRole("button", { name: "Complete" }));

    expect(text("polling-progress")).toBe("100%");
    expect(text("polling-business-state")).toBe("completed");
    expect(text("polling-node-status")).toBe("success");
    expect(text("polling-timer-count")).toBe("0");
  });

  it("shows business failure while retaining progress", async () => {
    render(PollingProgressScenario);
    await mountConsumer();
    await fireEvent.click(screen.getByRole("button", { name: "Fail" }));

    expect(text("polling-progress")).toBe("25%");
    expect(text("polling-business-state")).toBe("failed");
    expect(text("polling-node-status")).toBe("error");
    expect(text("polling-error")).toBe("GraphPollingConditionError");
    expect(text("polling-timer-count")).toBe("0");
  });

  it("demonstrates retry with a deterministic delay", async () => {
    render(PollingProgressScenario);
    await mountConsumer();
    await fireEvent.click(
      screen.getByRole("button", { name: "Fail next request" })
    );

    expect(text("polling-retry-attempt")).toBe("1");
    expect(text("polling-next-delay")).toBe("500");
    expect(text("polling-request-count")).toBe("2");

    await fireEvent.click(screen.getByRole("button", { name: "Advance one poll" }));
    expect(text("polling-retry-attempt")).toBe("0");
    expect(text("polling-request-count")).toBe("3");
    expect(text("polling-maximum-active")).toBe("1");
  });

  it("pauses without requests and resumes one remaining delay", async () => {
    render(PollingProgressScenario);
    await mountConsumer();
    await fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(text("polling-lifecycle")).toBe("paused");
    expect(text("polling-timer-count")).toBe("0");
    expect(
      screen
        .getByRole("button", { name: "Advance one poll" })
        .getAttribute("disabled")
    ).not.toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(text("polling-lifecycle")).toBe("active");
    expect(text("polling-timer-count")).toBe("1");
    expect(text("polling-request-count")).toBe("1");
  });

  it("times out and retains the latest progress", async () => {
    render(PollingProgressScenario);
    await mountConsumer();
    await fireEvent.click(screen.getByRole("button", { name: "Trigger timeout" }));

    expect(text("polling-progress")).toBe("90%");
    expect(text("polling-node-status")).toBe("error");
    expect(text("polling-error")).toBe("GraphPollingTimeoutError");
    expect(text("polling-timer-count")).toBe("0");
  });

  it("unmounts and resets with no outstanding timers", async () => {
    render(PollingProgressScenario);
    await mountConsumer();
    await fireEvent.click(screen.getByRole("button", { name: "Unmount consumer" }));

    expect(text("polling-consumer")).toBe("unmounted");
    expect(text("polling-timer-count")).toBe("0");

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(text("polling-request-count")).toBe("0");
    expect(text("polling-progress")).toBe("0%");
    expect(text("polling-timer-count")).toBe("0");
  });
});
