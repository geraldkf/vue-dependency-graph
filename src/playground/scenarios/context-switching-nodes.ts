import { defineContextNode, defineDataNode } from "../../core";
import { createMockLoader } from "../mock-loader";

/**
 * Node keys across all scenarios share one graph once V5G assembles the
 * playground's single runtime (`createGraph` rejects duplicate keys, so
 * this isn't decorative) — namespaced per scenario to stay unique.
 */
export const userIds = [1, 2, 3] as const;

export const selectedUserId = defineContextNode({
  key: "scenario:context-switching:selectedUserId",
  initialValue: userIds[0],
});

export const profileLoader = createMockLoader({ delayMs: 600 });

export const userProfile = defineDataNode({
  key: "scenario:context-switching:userProfile",
  dependencies: [selectedUserId] as const,
  initialValue: "",
  load: async ({ get }) =>
    profileLoader.load(() => `Profile for user #${get(selectedUserId)}`),
});
