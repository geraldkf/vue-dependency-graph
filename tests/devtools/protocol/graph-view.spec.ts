import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
} from "../../../src/core";
import { computeGraphView } from "../../../src/devtools/protocol/graph-view";

describe("computeGraphView", () => {
  it("lays out offline topology even when state and subscription rows are absent", () => {
    const node = defineContextNode({ key: "node", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    const view = computeGraphView({
      ...runtime.createDiagnosticSnapshot(),
      nodes: [],
      subscriptions: [],
    });
    expect(view.nodes).toEqual([
      {
        key: "node",
        kind: "context",
        status: "idle",
        freshness: "stale",
        hasSuccessfulValue: false,
        hasError: false,
        subscriberCount: 0,
        hasRefreshPolicy: false,
        column: 0,
        row: 0,
      },
    ]);
    runtime.shutdown();
  });
  it("lays out a diamond dependency into deterministic columns and rows, with an event lane", () => {
    const ProfileUpdated = defineEvent<{ userId: string }>("profile.updated");
    const UserId = defineContextNode<string>({ key: "userId", initialValue: "u1" });
    const Profile = defineDataNode({
      key: "profile",
      dependencies: [UserId] as const,
      initialValue: null,
      invalidatedBy: [{ event: ProfileUpdated, when: () => true }],
      load: () => Promise.resolve({ name: "Gerald" }),
    });
    const AvatarUrl = defineDerivedNode({
      key: "avatarUrl",
      dependencies: [Profile] as const,
      derive: () => "https://example.com/avatar.png",
    });
    const DisplayName = defineDerivedNode({
      key: "displayName",
      dependencies: [Profile] as const,
      derive: ({ get }) => get(Profile)?.name ?? "",
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [UserId, Profile, AvatarUrl, DisplayName] }),
    );

    const view = computeGraphView(runtime.createDiagnosticSnapshot());

    const positionOf = (key: string) => view.nodes.find((node) => node.key === key);
    expect(positionOf("userId")).toMatchObject({ column: 0, row: 0 });
    expect(positionOf("profile")).toMatchObject({ column: 1, row: 0 });
    // Alphabetical within a column: "avatarUrl" sorts before "displayName".
    expect(positionOf("avatarUrl")).toMatchObject({ column: 2, row: 0 });
    expect(positionOf("displayName")).toMatchObject({ column: 2, row: 1 });

    expect(view.events).toEqual([{ key: "profile.updated", column: -1, row: 0 }]);

    expect(view.edges).toEqual(
      expect.arrayContaining([
        { kind: "dependency", from: "userId", to: "profile" },
        { kind: "dependency", from: "profile", to: "avatarUrl" },
        { kind: "dependency", from: "profile", to: "displayName" },
        { kind: "event", from: "profile.updated", to: "profile" },
      ]),
    );
    expect(view.edges).toHaveLength(4);
    expect(view.columnCount).toBe(3);
    expect(view.maxRowCount).toBe(2);
  });

  it("reflects live node status and freshness after execution", async () => {
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      load: () => Promise.resolve(42),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }));
    await runtime.execute([Count]);

    const view = computeGraphView(runtime.createDiagnosticSnapshot());

    expect(view.nodes).toEqual([
      expect.objectContaining({
        key: "count",
        status: "success",
        freshness: "fresh",
        hasSuccessfulValue: true,
        hasError: false,
      }),
    ]);
  });

  it("produces an empty view for an empty graph", () => {
    const view = computeGraphView(
      createGraphRuntime(createGraph({ nodes: [] })).createDiagnosticSnapshot(),
    );
    expect(view).toEqual({
      nodes: [],
      events: [],
      edges: [],
      columnCount: 0,
      maxRowCount: 0,
    });
  });
});
