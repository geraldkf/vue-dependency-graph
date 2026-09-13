import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import ConcurrencyLimitScenario from "../../../src/playground/scenarios/ConcurrencyLimitScenario.vue";

const runAll = async (): Promise<void> => {
  await fireEvent.click(screen.getByRole("button", { name: "Run all" }));
};

const expectActiveCount = async (count: number): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByTestId("active-count").textContent).toBe(String(count));
  });
};

describe("ConcurrencyLimitScenario", () => {
  it("limits active loaders and admits queued loaders in FIFO order", async () => {
    render(ConcurrencyLimitScenario);

    await runAll();
    await expectActiveCount(2);
    expect(screen.getByTestId("start-order").textContent).toBe("first, second");
    expect(screen.getByTestId("maximum-observed").textContent).toBe("2");
    expect(screen.getByTestId("loader-state-third").textContent?.trim()).toBe(
      "waiting"
    );

    await fireEvent.click(screen.getByRole("button", { name: "Complete next" }));
    await waitFor(() => {
      expect(screen.getByTestId("start-order").textContent).toBe(
        "first, second, third"
      );
    });
    expect(screen.getByTestId("maximum-observed").textContent).toBe("2");
  });

  it("starts all independent loaders when unlimited is selected", async () => {
    render(ConcurrencyLimitScenario);

    await fireEvent.update(
      screen.getByRole("combobox", { name: "Maximum concurrent loads" }),
      "unlimited"
    );
    await runAll();

    await expectActiveCount(4);
    expect(screen.getByTestId("maximum-observed").textContent).toBe("4");
    expect(screen.getByTestId("start-order").textContent).toBe(
      "first, second, third, fourth"
    );
  });

  it("reset completes running work and restores clean scenario state", async () => {
    render(ConcurrencyLimitScenario);

    await runAll();
    await expectActiveCount(2);
    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("active-count").textContent).toBe("0");
      expect(screen.getByTestId("maximum-observed").textContent).toBe("0");
      expect(screen.getByTestId("start-order").textContent).toBe("None");
      expect(
        (screen.getByRole("button", { name: "Run all" }) as HTMLButtonElement)
          .disabled
      ).toBe(false);
    });
  });
});
