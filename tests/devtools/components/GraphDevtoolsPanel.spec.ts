import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, within, waitFor } from "@testing-library/vue";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
} from "../../../src/core";
import GraphDevtoolsPanel from "../../../src/devtools/components/GraphDevtoolsPanel.vue";

const buildRuntime = () => {
  const UserId = defineContextNode<string>({ key: "panel-userId", initialValue: "u1" });
  const Profile = defineDataNode({
    key: "panel-profile",
    dependencies: [UserId] as const,
    initialValue: null,
    load: () => Promise.resolve({ name: "Gerald" }),
  });
  const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
  const runtime = createGraphRuntime(createGraph({ nodes: [UserId, Profile] }), {
    diagnostics: { sink: diagnostics },
  });
  return { runtime, diagnostics, Profile };
};

describe("GraphDevtoolsPanel", () => {
  it("defaults to the Graph tab and renders a node per graph key", async () => {
    const { runtime, diagnostics } = buildRuntime();
    render(GraphDevtoolsPanel, { props: { runtime, diagnostics } });

    expect(screen.getByTestId("gdt-graph-node-panel-userId")).toBeTruthy();
    expect(screen.getByTestId("gdt-graph-node-panel-profile")).toBeTruthy();
  });

  it("clicking a graph node switches to the Node tab and shows its detail", async () => {
    const { runtime, diagnostics } = buildRuntime();
    render(GraphDevtoolsPanel, { props: { runtime, diagnostics } });

    await fireEvent.click(screen.getByTestId("gdt-graph-node-panel-profile"));

    expect(screen.getByTestId("gdt-inspector-key").textContent).toContain("panel-profile");
  });

  it("the Timeline tab lists events and clicking a node link selects it", async () => {
    const { runtime, diagnostics, Profile } = buildRuntime();
    render(GraphDevtoolsPanel, { props: { runtime, diagnostics } });
    await runtime.execute([Profile]);

    await fireEvent.click(screen.getByTestId("gdt-tab-timeline"));
    const list = screen.getByTestId("gdt-timeline-list");
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);

    const nodeLinks = within(list).getAllByText("panel-profile", { selector: "button" });
    expect(nodeLinks.length).toBeGreaterThan(0);
    await fireEvent.click(nodeLinks[0]!);

    expect(screen.getByTestId("gdt-inspector-key").textContent).toContain("panel-profile");
  });

  it("the Metrics tab renders once a diagnostics collector is attached", async () => {
    const { runtime, diagnostics, Profile } = buildRuntime();
    render(GraphDevtoolsPanel, { props: { runtime, diagnostics } });
    await runtime.execute([Profile]);

    await fireEvent.click(screen.getByTestId("gdt-tab-metrics"));

    expect(screen.getByTestId("gdt-metrics-panel").textContent).not.toContain(
      "No metrics available"
    );
  });

  it("exporting and then loading the same snapshot switches into offline mode, and returning to live switches back", async () => {
    const { runtime, diagnostics, Profile } = buildRuntime();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    // jsdom doesn't implement the Blob URL APIs at all (unlike `.text()`,
    // which exists but is broken - see tests/setup.ts) - there's nothing
    // to spy on, so these are assigned directly and restored afterward.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await runtime.execute([Profile]);
    const { container } = render(GraphDevtoolsPanel, { props: { runtime, diagnostics } });

    await fireEvent.click(screen.getByText("Export snapshot"));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    const exportedBlob = createObjectURL.mock.calls[0]![0] as Blob;
    const exportedJson = await exportedBlob.text();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([exportedJson], "snapshot.json", { type: "application/json" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    await fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByTestId("gdt-mode-badge").textContent).toContain("offline");
    });
    expect(screen.getByTestId("gdt-graph-node-panel-profile")).toBeTruthy();

    await fireEvent.click(screen.getByText("Return to live"));
    expect(screen.queryByTestId("gdt-mode-badge")).toBeNull();

    clickSpy.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("shows a clear error for an unrelated or corrupted file instead of failing silently", async () => {
    const { runtime, diagnostics } = buildRuntime();
    const { container } = render(GraphDevtoolsPanel, { props: { runtime, diagnostics } });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["not json at all"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    await fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByTestId("gdt-import-error")).toBeTruthy();
    });
    // Still live - a bad import must not silently strand the panel.
    expect(screen.queryByTestId("gdt-mode-badge")).toBeNull();
  });
});
