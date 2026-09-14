import { createPinia } from "pinia";
import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it } from "vitest";
import TypedEventsScenario from "../../../src/playground/scenarios/TypedEventsScenario.vue";
import {
  capabilityStatusLoader,
  unrelatedEventLoader,
} from "../../../src/playground/scenarios/typed-events-nodes";

const renderScenario = () =>
  render(TypedEventsScenario, {
    global: {
      plugins: [createPinia()],
    },
  });

const requestCount = (): string =>
  screen.getByTestId("typed-events-request-count").textContent ?? "";

const waitForInitialLoad = async (): Promise<void> => {
  await waitFor(() => {
    expect(requestCount()).toContain("1");
    expect(screen.getByTestId("typed-events-node-state").textContent).toContain(
      "success / fresh"
    );
  });
};

describe("TypedEventsScenario", () => {
  beforeEach(() => {
    capabilityStatusLoader.reset();
    unrelatedEventLoader.reset();
  });

  it("reloads capability status for a matching appointment event", async () => {
    renderScenario();
    await waitForInitialLoad();

    await fireEvent.click(
      screen.getByRole("button", { name: "Publish matching event" })
    );

    await waitFor(() => {
      expect(requestCount()).toContain("2");
      expect(screen.getByTestId("typed-events-status").textContent).toContain(
        "request 2"
      );
      expect(screen.getByTestId("typed-events-outcome").textContent).toContain(
        "matching event reloaded capability status"
      );
    });
  });

  it("leaves capability status untouched for a non-matching event", async () => {
    renderScenario();
    await waitForInitialLoad();

    await fireEvent.click(
      screen.getByRole("button", { name: "Publish non-matching event" })
    );

    await waitFor(() => {
      expect(screen.getByTestId("typed-events-outcome").textContent).toContain(
        "non-matching event ignored"
      );
    });
    expect(requestCount()).toContain("1");
    expect(screen.getByTestId("typed-events-status").textContent).toContain(
      "request 1"
    );
  });

  it("keeps a staged event invisible until transaction commit", async () => {
    renderScenario();
    await waitForInitialLoad();

    await fireEvent.click(
      screen.getByRole("button", { name: "Start event transaction" })
    );

    expect(
      screen.getByTestId("typed-events-transaction-phase").textContent
    ).toContain("staged");
    expect(requestCount()).toContain("1");

    await fireEvent.click(
      screen.getByRole("button", { name: "Commit event transaction" })
    );

    await waitFor(() => {
      expect(requestCount()).toContain("2");
      expect(
        screen.getByTestId("typed-events-transaction-phase").textContent
      ).toContain("committed");
    });
  });

  it("discards a staged event when the transaction rolls back", async () => {
    renderScenario();
    await waitForInitialLoad();

    await fireEvent.click(
      screen.getByRole("button", { name: "Start event transaction" })
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Rollback event transaction" })
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-transaction-phase").textContent
      ).toContain("rolled-back");
      expect(screen.getByTestId("typed-events-outcome").textContent).toContain(
        "Typed event transaction rollback"
      );
    });
    expect(requestCount()).toContain("1");
  });

  it("resets scenario state deterministically", async () => {
    renderScenario();
    await waitForInitialLoad();
    await fireEvent.click(
      screen.getByRole("button", { name: "Publish matching event" })
    );
    await waitFor(() => expect(requestCount()).toContain("2"));

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(requestCount()).toContain("1");
      expect(screen.getByTestId("typed-events-outcome").textContent).toContain(
        "ready"
      );
      expect(
        screen.getByTestId("typed-events-transaction-phase").textContent
      ).toContain("idle");
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    });
  });

  it("releases an open event transaction when unmounted", async () => {
    const rendered = renderScenario();
    await waitForInitialLoad();
    await fireEvent.click(
      screen.getByRole("button", { name: "Start event transaction" })
    );

    rendered.unmount();
    await Promise.resolve();
  });
  it("applies an unrelated runtime event before transaction closure and preserves it after rollback", async () => {
    renderScenario();
    await waitForInitialLoad();
    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-independent-requests").textContent
      ).toContain("1");
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Start event transaction" })
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Publish unrelated event now" })
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-independent-requests").textContent
      ).toContain("2");
      expect(
        screen.getByTestId("typed-events-independent-status").textContent
      ).toContain("request 2");
      expect(
        screen.getByTestId("typed-events-independent-outcome").textContent
      ).toContain("reloaded before transaction closed");
    });
    expect(
      screen.getByTestId("typed-events-transaction-phase").textContent
    ).toContain("staged");
    expect(requestCount()).toContain("1");

    await fireEvent.click(
      screen.getByRole("button", { name: "Rollback event transaction" })
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-transaction-phase").textContent
      ).toContain("rolled-back");
    });
    expect(requestCount()).toContain("1");
    expect(
      screen.getByTestId("typed-events-independent-requests").textContent
    ).toContain("2");
    expect(
      screen.getByTestId("typed-events-independent-status").textContent
    ).toContain("request 2");
  });

  it("enables the unrelated publication only while an event transaction is staged", async () => {
    renderScenario();
    await waitForInitialLoad();

    const unrelatedButton = screen.getByRole("button", {
      name: "Publish unrelated event now",
    });
    expect(unrelatedButton).toHaveProperty("disabled", true);

    await fireEvent.click(
      screen.getByRole("button", { name: "Start event transaction" }),
    );
    expect(unrelatedButton).toHaveProperty("disabled", false);

    await fireEvent.click(unrelatedButton);
    expect(unrelatedButton).toHaveProperty("disabled", true);
  });

  it("reset restores unrelated event state after an isolated publication", async () => {
    renderScenario();
    await waitForInitialLoad();
    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-independent-requests").textContent,
      ).toContain("1");
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Start event transaction" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "Publish unrelated event now" }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-independent-requests").textContent,
      ).toContain("2");
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Rollback event transaction" }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-transaction-phase").textContent,
      ).toContain("rolled-back");
    });

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(
        screen.getByTestId("typed-events-independent-requests").textContent,
      ).toContain("1");
      expect(
        screen.getByTestId("typed-events-independent-outcome").textContent,
      ).toContain("not published");
      expect(
        screen.getByTestId("typed-events-independent-status").textContent,
      ).toContain("request 1");
    });
  });

});
