# Performance baseline

The reproducible harness is `pnpm benchmark` after `pnpm build`. It creates one context root, 100/500/1,000 data nodes, one derived leaf per data node, demand for all leaves, concurrency eight, explicit release policies, and either one or 100 global state observers. It measures five cascades after a warm-up with diagnostics disabled/enabled.

Each run asserts exactly seven loads per data node across startup and six context changes, correct final derivation, and zero demand after shutdown. Diagnostic retention stays capped at 1,000. Timings exclude network latency and should be compared on the same host with otherwise idle processes.

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
