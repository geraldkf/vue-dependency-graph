import { defineDataNode } from "../../core";
import { createMockLoader } from "../mock-loader";

export const toggleableLoader = createMockLoader({ delayMs: 300 });

export const toggleableResource = defineDataNode({
  key: "scenario:unmount-cleanup:toggleableResource",
  dependencies: [] as const,
  initialValue: "",
  load: async () => toggleableLoader.load(() => "Toggleable resource data"),
});
