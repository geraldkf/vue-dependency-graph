# Performance baseline

The reproducible harness is `pnpm benchmark` after `pnpm build`. It now compares full demand, sparse demand and changes to one independent branch at 100/500/1,000 data nodes, with one derived leaf per data node and concurrency eight. Each workload runs with diagnostics and release policies on/off and one or up to 100 observing consumers: 72 configurations. It measures five cascades after a warm-up. The original full-demand baseline is preserved below.

Each run asserts exact per-node loads and derivations across startup and six context changes, correct final values/freshness, no loading of undemanded nodes, no recomputation in unchanged branches, and zero demand across the entire graph after shutdown. Diagnostic retention stays capped at 1,000. Timings exclude network latency and should be compared on the same host with otherwise idle processes.

## Initial local measurement

On 3 October 2026, Windows, Node 24.19.0, diagnostic-disabled median cascades were:

| Data + derived nodes | One observer | 100 observers |
| -------------------- | -----------: | ------------: |
| 100 + 100            |      5.95 ms |       8.31 ms |
| 500 + 500            |    146.78 ms |     159.13 ms |
| 1,000 + 1,000        |    774.22 ms |     860.99 ms |

The raw diagnostic-enabled and disabled results are in [benchmark-baseline.json](./benchmark-baseline.json). This is a local baseline, not a browser performance guarantee or CI timing threshold.

A repeat against the final maintenance build passed all 12 request-count and cleanup checks. Diagnostic-disabled medians for one observer were 5.67/156.92/729.24 ms; with 100 observers they were 8.34/159.88/902.67 ms. The timing variation reinforces using application measurements rather than fixed CI millisecond thresholds.

The curve shows that large synchronous cascades need scrutiny. Global state notifications trigger policy scans and observer snapshot reads, so growing graphs can amplify work substantially. The release controller now excludes nodes with no effective release policy from reconciliation; explicitly configured policies still scan their eligible nodes.

For the migration trial, measure the actual graph size, demanded subset, API latency, time to useful UI, and diagnostic overhead. Use coherent workflow-sized runtimes. If the application reproduces unacceptable costs, evaluate change summaries and per-node observation before adding a general extension host or rewriting the scheduler. Preserve synchronous transaction notification semantics while doing so.

## Realistic demand and branch comparisons

The follow-up run on Windows, Node 24.19.0, covers:

- **Full demand:** all leaves subscribed; one context change affects every branch.
- **Sparse demand:** only 5% of leaves subscribed, with a minimum of 10. Undemanded nodes are invalidated but must never load or derive.
- **Single branch:** 10 independent context roots, all leaves subscribed; change one root, affecting 10% of data/derived pairs. The other branches must keep their fresh values without extra work.

All workloads compare an explicit 10-second release policy on every data node with no release policies. The observer count is capped at the demanded subset; the sparse 1,000-node case uses 1 or 50 observers, rather than pretending it has 100 consumers.

The following medians use one observer, diagnostics disabled, 1,000 data plus 1,000 derived nodes. The raw 72 configurations are saved in [benchmark-workloads.json](./benchmark-workloads.json).

| Workload      | Demanded / changed data nodes | Release policies on | Release policies off | Notifications per cascade |
| ------------- | ----------------------------: | ------------------: | -------------------: | ------------------------: |
| Full demand   |                 1,000 / 1,000 |           868.60 ms |              8.55 ms |                     4,004 |
| Sparse demand |                       50 / 50 |            49.42 ms |              1.63 ms |                       204 |
| Single branch |                   1,000 / 100 |            88.99 ms |              1.10 ms |                       404 |

Exact total requests, including startup and six changes, were 7,000/350/1,600 respectively; derived execution counts matched. Every measured cascade emitted the same notification count within its workload. These counts establish that unrelated branches and undemanded nodes avoided extra loads. They do not mean unrelated policies avoided scanning.

The on/off comparison is an experimental control, not advice to remove release policies when they are needed for memory management. It isolates an optional-policy cost that the original full-demand benchmark could not separate from ordinary execution.

## CPU profiling and the next optimization target

CPU profiles cover graph construction, initial load and six context changes. Their self-sample percentages include warm-up and are approximate; profiled timings are not used in the table above. Summaries are in [profile-summary.json](./profile-summary.json). The raw profiles stay in the ignored `browser-results/profiles` directory and can be opened in a CPU profiler.

For the full-demand release-enabled case, leading self-sample frames included `getSubscriptionState` (18.7%), `resolveReleaseDurationMs` (11.5%), `reconcileNode` (11.1%), `notify` (10.5%) and release `reconcile` (10.0%). The branch-local profile showed the same group of hot paths. The no-release control was much shorter, with only 115 samples, so precise rankings for that control would be misleading.

Inspection agrees with the measurements: every global state notification invokes release reconciliation, which scans every eligible data node, looks up demand, and checks its timer session. In the 1,000-node full-demand case, 4,004 notifications imply roughly four million eligible-node checks per cascade. Sparse demand and branch-local invalidation reduce notifications but still scan the full eligible set.

This profiling identified incremental release reconciliation as the next optimization: reconsider nodes whose demand or state changed, with a full pass for initialization. The implementation and its comparison are recorded below.

Reproduce individual workloads or profiles without new dependencies:

```bash
node scripts/benchmark.mjs --workload=sparse-demand --size=1000 --observers=1 --diagnostics=off --release=on
node scripts/benchmark.mjs --workload=single-branch --size=1000 --observers=1 --diagnostics=off --release=off
# Create browser-results/profiles first; that directory is ignored by Git.
node --cpu-prof --cpu-prof-dir=browser-results/profiles --cpu-prof-name=full-demand.cpuprofile scripts/benchmark.mjs --workload=full-demand --size=1000 --observers=1 --diagnostics=off --release=on
```

These are synchronous Node workloads with primitive payloads, no API delay, no Vue rendering, and no refresh policies. The application trial still needs actual demand, payload sizes, refresh behavior and time to useful UI. Timing thresholds remain outside CI; the benchmark's correctness assertions are deterministic.

## Incremental release reconciliation

Release policies now register their eligible runtime states with a change tracker. State transitions record changed keys without running policy work; subscription changes record affected direct and required keys before notification. Each synchronous release listener drains a deduplicated set and reconciles only those nodes. Initialization performs one full pass. Policy disposal clears the tracker and unregisters its states.

Existing generation checks, timer cancellation, undemanded prefetch release, default/Infinity overrides, and notification order are preserved. Refresh-policy reconciliation was made incremental afterwards; see [Refresh policies, per-node observation, and the demand index](#refresh-policies-per-node-observation-and-the-demand-index).

The comparison against revision `f893a5d` used the same Windows host and Node 24.19.0, with timing runs outside concurrent validation jobs. For 1,000 data plus 1,000 derived nodes, one observer, diagnostics disabled, and release policies enabled:

| Workload      | Previous median | Incremental median |
| ------------- | --------------: | -----------------: |
| Full demand   |       938.10 ms |           11.15 ms |
| Sparse demand |        49.22 ms |            2.22 ms |
| Single branch |        87.72 ms |            1.48 ms |

All 72 configurations passed the existing correctness assertions and retained identical request, derivation, notification, and retained-event counts. Raw before/after results are in [benchmark-incremental-release.json](./benchmark-incremental-release.json). These local timings demonstrate removal of the repeated release scan; they do not predict application or browser performance.

## Refresh policies, per-node observation, and the demand index

A review that profiled the runtime beyond the benchmark's original scenarios found three costs that grew with graph size or with the number of mounted components rather than with the work being done. The design is recorded in [ADR-022](../decisions/ADR-022-per-node-notification-and-incremental-refresh.md):

- Every notification reconciled every node with a refresh policy. The benchmark had no refresh policies, so this was not visible. Refresh reconciliation now handles only changed nodes, as release reconciliation does.
- Every mounted `useNode` / `useNodes` re-read its node on every notification in the graph. The composables now use `runtime.onNodeChange`, which fires only for the node whose state changed.
- Every scheduler flush scanned every graph node for direct subscribers. The subscription controller now keeps an index of them.

`shutdown()` also stopped throwing a `RangeError` when one node holds on the order of 200,000 subscriptions.

These measurements are from a different machine than the sections above (Linux, Node 22.23.4, a shared sandbox), so compare rows within a table, not against earlier tables. Medians of five cascades, diagnostics and release policies disabled, 1,000 data plus 1,000 derived nodes, full demand.

**Refresh policy (`staleAfter`) on every data node, one observer** (`--refresh=on`):

| Data nodes | Before median | After median |
| ---------: | ------------: | -----------: |
|        100 |      10.85 ms |      6.17 ms |
|        500 |     216.87 ms |     26.78 ms |
|      1,000 |   1,170.72 ms |     40.30 ms |

**Mounted observers, one cascade** (each observer re-reads its own node; before: `onChange`, after: `onNodeChange`, `--observe=node`):

| Observers | Before median | After median |
| --------: | ------------: | -----------: |
|       100 |      85.43 ms |     50.07 ms |
|       500 |     234.88 ms |     38.04 ms |
|     1,000 |     348.41 ms |     36.59 ms |

**Mounting N components, each subscribing one node and listening to it** (synchronous mount, initial load until settled, unmount; before and after):

| Components |               Mount |           Initial load |             Unmount |
| ---------: | ------------------: | ---------------------: | ------------------: |
|      1,000 |  79.3 ms to 24.6 ms |   527.3 ms to 102.4 ms |  44.2 ms to 12.4 ms |
|      2,000 | 290.9 ms to 45.0 ms | 2,232.1 ms to 165.4 ms | 206.9 ms to 18.8 ms |

**Subscribe and settle one node in a sparse graph** (100 repetitions, per repetition):

| Graph nodes |   Before |   After |
| ----------: | -------: | ------: |
|       2,000 |  0.83 ms | 0.25 ms |
|      10,000 |  3.51 ms | 0.13 ms |
|      40,000 | 17.53 ms | 0.13 ms |

The default benchmark workloads (full, sparse and single-branch demand, release policies enabled) are unchanged within run-to-run noise, with identical request, derivation and notification counts. Every mode passes the benchmark's existing correctness assertions.

Reproduce:

```bash
pnpm build
node scripts/benchmark.mjs --workload=full-demand --size=1000 --observers=1 --diagnostics=off --release=off --refresh=on
node scripts/benchmark.mjs --workload=full-demand --size=1000 --observers=1000 --diagnostics=off --release=off --observe=node
```

`--observers=N` accepts any count, and without `--refresh` or `--observe` a run uses the original configuration. Note that the observer benchmark measures the listener mechanism with one observer per node; the application-level effect depends on how many components are mounted and which nodes they read.

Costs not addressed here: enabling diagnostics still costs about 2.5 to 4 times at this scale because of event volume, children are ordered with `localeCompare` when a graph is created, and the mutation path scans graph nodes once per call.
