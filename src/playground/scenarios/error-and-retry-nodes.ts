import { defineDataNode } from "../../core";
import { createMockLoader } from "../mock-loader";

export const flakyLoader = createMockLoader({ delayMs: 600 });

export const flakyResource = defineDataNode({
  key: "scenario:error-and-retry:flakyResource",
  dependencies: [] as const,
  initialValue: "",
  load: async () => flakyLoader.load(() => "Loaded successfully"),
});
