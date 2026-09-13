import { defineDataNode } from "../../core";
import { createMockLoader } from "../mock-loader";

const metricALoader = createMockLoader({ delayMs: 400 });
const metricBLoader = createMockLoader({ delayMs: 400 });
export const metricCLoader = createMockLoader({ delayMs: 400 });

export const metricA = defineDataNode({
  key: "scenario:aggregate-query:metricA",
  dependencies: [] as const,
  initialValue: 0,
  load: async () => metricALoader.load(() => 42),
});

export const metricB = defineDataNode({
  key: "scenario:aggregate-query:metricB",
  dependencies: [] as const,
  initialValue: 0,
  load: async () => metricBLoader.load(() => 17),
});

/**
 * The only one of the three with its failure toggle exposed in the UI —
 * this scenario is specifically about partial failure across a useNodes
 * query, not about every node being independently controllable.
 */
export const metricC = defineDataNode({
  key: "scenario:aggregate-query:metricC",
  dependencies: [] as const,
  initialValue: 0,
  load: async () => metricCLoader.load(() => 99),
});
