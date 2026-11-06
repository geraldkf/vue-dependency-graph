import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  staleAfter,
} from "../dist/core/index.js";

const options = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    assert(
      [
        "--workload",
        "--size",
        "--observers",
        "--diagnostics",
        "--release",
        "--refresh",
        "--observe",
      ].includes(key) && value,
      `Invalid option: ${arg}`,
    );
    return [key, value];
  }),
);
const select = (key, choices) => {
  const value = options.get(key);
  assert(!value || choices.some((choice) => String(choice) === value), `Invalid ${key}: ${value}`);
  return value ? choices.filter((choice) => String(choice) === value) : choices;
};
// Opt-in dimensions: the default run keeps its 72 configurations.
//   --refresh=on    every data node carries a stale-after refresh policy
//   --observe=node  observers use runtime.onNodeChange instead of onChange
//   --observers=N   any observer count (default: 1 and 100)
const refreshModes = select("--refresh", ["off", "on"]).filter(
  (mode) => options.has("--refresh") || mode === "off",
);
const observeMode = options.get("--observe") ?? "global";
assert(["global", "node"].includes(observeMode), `Invalid --observe: ${observeMode}`);
const observerChoices = options.has("--observers")
  ? [Number(options.get("--observers"))]
  : [1, 100];
assert(
  observerChoices.every((count) => Number.isInteger(count) && count > 0),
  "Invalid --observers",
);
const samples = [];
for (const workload of select("--workload", ["full-demand", "sparse-demand", "single-branch"])) {
  for (const size of select("--size", [100, 500, 1000])) {
    for (const requestedObservers of observerChoices) {
      for (const diagnosticMode of select("--diagnostics", ["off", "on"])) {
        for (const releaseMode of select("--release", ["on", "off"])) {
          for (const refreshMode of refreshModes) {
            const diagnosticsEnabled = diagnosticMode === "on";
            const branchCount = workload === "single-branch" ? 10 : 1;
            const roots = Array.from({ length: branchCount }, (_, i) =>
              defineContextNode({ key: `context:${i}`, initialValue: 0 }),
            );
            const demandedCount = workload === "sparse-demand" ? Math.max(10, size / 20) : size;
            const loads = Array(size).fill(0);
            const derivations = Array(size).fill(0);
            const data = Array.from({ length: size }, (_, i) => {
              const context = roots[i % branchCount];
              return defineDataNode({
                key: `data:${i}`,
                dependencies: [context],
                initialValue: -1,
                ...(releaseMode === "on" ? { release: 10000 } : {}),
                ...(refreshMode === "on" ? { refresh: staleAfter({ durationMs: 600000 }) } : {}),
                load: async ({ get }) => {
                  loads[i] += 1;
                  return get(context);
                },
              });
            });
            const leaves = data.map((parent, i) =>
              defineDerivedNode({
                key: `derived:${i}`,
                dependencies: [parent],
                derive: ({ get }) => {
                  derivations[i] += 1;
                  return get(parent) * 2;
                },
              }),
            );
            const collector = createInMemoryGraphDiagnostics({ capacity: 1000 });
            const runtime = createGraphRuntime(
              createGraph({ nodes: [...roots, ...data, ...leaves] }),
              {
                maxConcurrentLoads: 8,
                ...(diagnosticsEnabled ? { diagnostics: { sink: collector } } : {}),
              },
            );
            let notifications = 0;
            const countNotifications = runtime.onChange(() => {
              notifications += 1;
            });
            const subscription = runtime.subscribeNodes(leaves.slice(0, demandedCount));
            const observerCount = Math.min(requestedObservers, demandedCount);
            const stops = leaves
              .slice(0, observerCount)
              .map((node) =>
                observeMode === "node"
                  ? runtime.onNodeChange(node, () => runtime.getState(node))
                  : runtime.onChange(() => runtime.getState(node)),
              );
            try {
              await runtime.whenSettled();
              const times = [];
              const cascadeNotifications = [];
              for (let round = 1; round <= 6; round += 1) {
                const before = notifications;
                const start = performance.now();
                runtime.setContext(roots[0], round);
                await runtime.whenSettled();
                if (round > 1) {
                  times.push(performance.now() - start);
                  cascadeNotifications.push(notifications - before);
                }
              }
              for (let i = 0; i < size; i += 1) {
                const demanded = i < demandedCount;
                const changed = i % branchCount === 0;
                const expectedLoads = demanded ? (changed ? 7 : 1) : 0;
                assert.equal(loads[i], expectedLoads, `Unexpected loads for data:${i}`);
                assert.equal(
                  derivations[i],
                  expectedLoads,
                  `Unexpected derivations for derived:${i}`,
                );
                if (demanded) {
                  assert.equal(runtime.getState(leaves[i]).data, changed ? 12 : 0);
                  assert.equal(runtime.getState(data[i]).freshness, "fresh");
                } else {
                  assert.equal(runtime.getState(data[i]).hasSuccessfulValue, false);
                }
              }
              times.sort((a, b) => a - b);
              samples.push({
                workload,
                contextNodes: branchCount,
                dataNodes: size,
                derivedNodes: size,
                demandedDataNodes: demandedCount,
                changedDemandedDataNodes: demandedCount / branchCount,
                observers: observerCount,
                requestedObservers,
                diagnostics: diagnosticsEnabled,
                releasePolicies: releaseMode === "on",
                refreshPolicies: refreshMode === "on",
                observeMode,
                medianCascadeMs: Number(times[2].toFixed(2)),
                maximumCascadeMs: Number(times.at(-1).toFixed(2)),
                notificationsPerCascade: cascadeNotifications,
                requests: loads.reduce((sum, count) => sum + count, 0),
                derivations: derivations.reduce((sum, count) => sum + count, 0),
                retainedEvents: diagnosticsEnabled ? collector.getEvents().length : 0,
              });
            } finally {
              for (const stop of stops) stop();
              countNotifications();
              subscription.unsubscribe();
              runtime.shutdown();
              await runtime.whenSettled();
              for (const node of [...roots, ...data, ...leaves])
                assert.equal(runtime.getSubscriptionState(node).total, 0);
              assert.equal(runtime.getSchedulerState().isRunning, false);
            }
          }
        }
      }
    }
  }
}
console.log(
  JSON.stringify({ node: process.version, platform: process.platform, samples }, null, 2),
);
