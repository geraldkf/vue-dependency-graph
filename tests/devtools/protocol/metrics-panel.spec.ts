import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineDataNode,
} from "../../../src/core";
import { computeMetricsView } from "../../../src/devtools/protocol/metrics-panel";

describe("computeMetricsView", () => {
  it("returns no groups when metrics are unavailable", () => {
    expect(computeMetricsView(undefined)).toEqual({ groups: [] });
  });

  it("groups and formats a real metrics snapshot", async () => {
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      load: () => Promise.resolve(42),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      diagnostics: { sink: diagnostics },
    });
    await runtime.execute([Count]);

    const view = computeMetricsView(diagnostics.getMetrics());
    const titles = view.groups.map((group) => group.title);
    expect(titles).toEqual([
      "Events",
      "Operations",
      "Execution",
      "Invalidations",
      "Scheduler",
      "Refresh policies",
      "Transactions",
      "Mutations",
      "Subscriptions",
    ]);

    const execution = view.groups.find((group) => group.title === "Execution");
    const queueWait = execution?.rows.find((row) => row.label === "Queue wait");
    expect(queueWait?.value === "no samples" || /ms avg/.test(queueWait?.value ?? "")).toBe(true);
  });
});
