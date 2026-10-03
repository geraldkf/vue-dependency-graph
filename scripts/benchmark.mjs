import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../dist/core/index.js";

const samples = [];
for (const size of [100, 500, 1000]) {
  for (const observerCount of [1, Math.min(100, size)]) {
    for (const diagnosticsEnabled of [false, true]) {
      const context = defineContextNode({ key: "context", initialValue: 0 });
      let requests = 0;
      const data = Array.from({ length: size }, (_, i) =>
        defineDataNode({
          key: `data:${i}`,
          dependencies: [context],
          initialValue: -1,
          release: 10000,
          load: async ({ get }) => {
            requests += 1;
            return get(context);
          },
        }),
      );
      const leaves = data.map((parent, i) =>
        defineDerivedNode({
          key: `derived:${i}`,
          dependencies: [parent],
          derive: ({ get }) => get(parent) * 2,
        }),
      );
      const collector = createInMemoryGraphDiagnostics({ capacity: 1000 });
      const runtime = createGraphRuntime(createGraph({ nodes: [context, ...data, ...leaves] }), {
        maxConcurrentLoads: 8,
        ...(diagnosticsEnabled ? { diagnostics: { sink: collector } } : {}),
      });
      const subscription = runtime.subscribeNodes(leaves);
      const stops = leaves
        .slice(0, observerCount)
        .map((node) => runtime.onChange(() => runtime.getState(node)));
      await runtime.whenSettled();
      const times = [];
      for (let round = 1; round <= 6; round += 1) {
        const start = performance.now();
        runtime.setContext(context, round);
        await runtime.whenSettled();
        if (round > 1) times.push(performance.now() - start); // Warm-up round excluded.
      }
      assert.equal(requests, size * 7, "No duplicate or missing data loads");
      assert.equal(runtime.getState(leaves.at(-1)).data, 12);
      for (const stop of stops) stop();
      subscription.unsubscribe();
      runtime.shutdown();
      assert.equal(runtime.getSubscriptionState(data[0]).total, 0);
      times.sort((a, b) => a - b);
      samples.push({
        dataNodes: size,
        derivedNodes: size,
        observers: observerCount,
        diagnostics: diagnosticsEnabled,
        medianCascadeMs: Number(times[2].toFixed(2)),
        maximumCascadeMs: Number(times.at(-1).toFixed(2)),
        requests,
        retainedEvents: diagnosticsEnabled ? collector.getEvents().length : 0,
      });
    }
  }
}
console.log(
  JSON.stringify({ node: process.version, platform: process.platform, samples }, null, 2),
);
