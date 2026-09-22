import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  type GraphDiagnosticEvent,
} from "../../../src/core";
import { computeTimeline } from "../../../src/devtools/protocol/timeline";

describe("computeTimeline", () => {
  it("categorises, labels, and flags failures across a real event stream", async () => {
    const UserId = defineContextNode<string>({ key: "userId", initialValue: "u1" });
    const Failing = defineDataNode({
      key: "failing",
      dependencies: [UserId] as const,
      initialValue: null,
      load: () => Promise.reject(new Error("boom")),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [UserId, Failing] }), {
      diagnostics: { sink: diagnostics },
    });

    await expect(runtime.execute([Failing])).rejects.toThrow();

    const timeline = computeTimeline(diagnostics.getEvents());

    expect(timeline.length).toBeGreaterThan(0);
    // Preserves arrival order (sequence strictly increasing).
    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i]!.sequence).toBeGreaterThan(timeline[i - 1]!.sequence);
    }

    const failed = timeline.find((entry) => entry.type === "node.load.failed");
    expect(failed).toMatchObject({ category: "execution", nodeKey: "failing", isFailure: true });
    expect(failed?.label).toBe("Node Load Failed - failing");

    const requested = timeline.find((entry) => entry.type === "operation.execute.requested");
    expect(requested).toMatchObject({ category: "operation", isFailure: false });

    const succeeded = timeline.find((entry) => entry.type === "node.execution.reused");
    // (may or may not appear depending on generation reuse; only assert
    // when present, to avoid over-fitting to internal execution details)
    if (succeeded) expect(succeeded.isFailure).toBe(false);
  });

  it("returns an empty timeline for an empty event list", () => {
    expect(computeTimeline([])).toEqual([]);
  });

  it("maps node.value-released to its own release category", () => {
    // Constructed directly rather than through a real release-policy fire
    // (covered end-to-end in tests/core/release-policy.spec.ts) - this
    // test is specifically about the category mapping, not the release
    // mechanics themselves.
    const event: GraphDiagnosticEvent = {
      schemaVersion: 1,
      sequence: 1,
      timestamp: 0,
      runtimeId: "r1",
      type: "node.value-released",
      operationId: "op1",
      nodeKey: "count",
      idleMs: 1_000,
    };

    const [entry] = computeTimeline([event]);

    expect(entry).toMatchObject({ category: "release", nodeKey: "count", isFailure: false });
    expect(entry?.label).toBe("Node Value Released - count");
  });

  it("shows a listener failure as a failed runtime entry", () => {
    const event: GraphDiagnosticEvent = {
      schemaVersion: 1,
      sequence: 1,
      timestamp: 0,
      runtimeId: "r1",
      type: "runtime.listener-failed",
      operationId: "op1",
      error: { name: "Error", message: "listener boom" },
    };

    const [entry] = computeTimeline([event]);

    expect(entry).toMatchObject({
      category: "operation",
      operationId: "op1",
      isFailure: true,
    });
    expect(entry?.label).toBe("Runtime Listener Failed");
  });
});
