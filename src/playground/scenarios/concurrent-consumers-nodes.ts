import { defineDataNode } from "../../core";
import { createMockLoader } from "../mock-loader";

export const sharedResourceLoader = createMockLoader({ delayMs: 600 });

/**
 * No dependencies — this scenario is specifically about what happens when
 * two independent consumers mount on the same node, not about triggering
 * a re-load, so there's nothing here for a context change to invalidate.
 */
export const sharedResource = defineDataNode({
  key: "scenario:concurrent-consumers:sharedResource",
  dependencies: [] as const,
  initialValue: "",
  load: async () => sharedResourceLoader.load(() => "Shared resource data"),
});
