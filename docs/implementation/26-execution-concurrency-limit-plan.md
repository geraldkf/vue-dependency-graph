# Execution Concurrency Limit Plan

## Status

Planned. Not yet implemented. This is documentation only — no code changes until the approach is agreed.

## Objective

Add an optional cap on how many data-node loads can be in flight at once across the whole runtime, so an application can protect a backend or a browser's connection pool from an unbounded fan-out (for example, a context change that invalidates 50 subscribed nodes simultaneously).

## Premise checked first, not assumed

The request that led to this plan included the premise that execution currently runs sequentially and needs to be changed to use `Promise.all`. Before designing anything, this was checked directly against `src/core/execution/execution.ts` and then verified empirically, not just read:

- `ensureNode`'s dependency resolution already does `Promise.allSettled(graph.getParents(node).map(parent => ensureNode(parent)))` — every parent's resolution starts via `.map()` before anything is awaited, not a sequential loop.
- `execute()`'s top-level target resolution does the same: `Promise.allSettled(registeredTargets.map(target => ensureNode(target)))`.
- Empirical test: three sibling dependencies of one derived node, each with an artificial 100ms delay, completed in ~102ms total (not ~300ms), with the event log showing all three starting before any finished. Five independent top-level targets passed to one `execute()` call showed the same ~102ms result.

**Conclusion: concurrent execution of siblings and independent targets already works.** That part of the original request doesn't describe a real gap in the current code. What's actually missing, and is a real gap, is a **cap** — nothing today limits how many loads run at once. If 50 subscribed nodes all become stale from one context change, all 50 loads fire simultaneously with zero throttling. This plan addresses that gap specifically. If something else prompted the original "running everything sync" observation — a specific scenario, a specific node's behavior — that's worth describing directly, since nothing found so far reproduces it.

## Design

### What gets limited, and what doesn't

The cap applies only to `DataNodeDefinition.load()` calls — the actual asynchronous, typically I/O-bound work. It does not apply to:

- `DerivedNodeDefinition.derive()` — synchronous by design (see `docs/ARCHITECTURE.md`: "No API calls"), takes no meaningful time, and gating it would add queueing overhead for zero-cost work.
- Graph traversal and bookkeeping inside `ensureNode`/`executeNode` — dependency-graph walking and cached-value checks are near-instant and have nothing to do with the resource the cap is meant to protect.

### The primitive: a hand-rolled counting semaphore, not a dependency

`package.json` currently has exactly one runtime dependency (`vue`). A concurrency limiter is a small, well-understood primitive (a counter, a FIFO queue of waiters) — adding a third-party package like `p-limit` for this would be pulling in a dependency for something cheaper to own directly, and every dependency added here is one every consumer of this framework inherits. Hand-rolled:

```ts
export interface ExecutionConcurrencyLimiter {
  readonly acquire: (signal: AbortSignal) => Promise<void>;
  readonly release: () => void;
}

export const createExecutionConcurrencyLimiter = (
  maxConcurrent: number
): ExecutionConcurrencyLimiter => {
  if (maxConcurrent < 1) {
    throw new Error("maxConcurrent must be at least 1.");
  }

  let active = 0;
  const queue: Array<{
    readonly grant: () => void;
    readonly reject: (error: Error) => void;
  }> = [];

  const acquire = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) {
      return Promise.reject(
        new Error("Aborted before acquiring a concurrency slot.")
      );
    }
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = queue.indexOf(entry);
        if (index !== -1) queue.splice(index, 1);
        entry.reject(new Error("Aborted while waiting for a concurrency slot."));
      };
      const entry = {
        grant: () => {
          signal.removeEventListener("abort", onAbort);
          active += 1;
          resolve();
        },
        reject: (error: Error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      queue.push(entry);
    });
  };

  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next) next.grant();
  };

  return Object.freeze({ acquire, release });
};
```

With `maxConcurrent = Infinity` (the default — see below), `active < Infinity` is always true, so `acquire()` always resolves immediately and never queues. **This is what makes the feature fully backward-compatible by construction**, not by a separate opt-out flag: every existing call site and every existing test constructs `createGraphRuntime(graph)` with no options, gets `Infinity`, and observes byte-for-byte the same behavior as today.

### Where it plugs into `executeNode`

```ts
if (isDataNode(node)) {
  await limiter.acquire(controller.signal);
  try {
    value = await node.load({ get: getDependencyValue, signal: controller.signal });
  } finally {
    limiter.release();
  }
} else if (isDerivedNode(node)) {
  value = node.derive({ get: getDependencyValue });
}
```

`release()` runs in a `finally`, so a slot is freed whether the load succeeds, throws, or is aborted mid-flight.

### Abort-while-queued is a first-class case, not an afterthought

A load can be aborted (unsubscribe, invalidation, superseding generation) while it's still waiting in the queue, never having started. `acquire(signal)` listens for the same `AbortController.signal` `executeNode` already creates per attempt, and if it fires while queued, removes the entry from the queue and rejects immediately — the load never consumes a slot it was never going to use, and never calls `node.load()` with a signal that's already aborted.

**This rejection needs no new handling in `run()`'s existing catch block.** The existing obsolete-attempt classification already checks `controller.signal.aborted` as one of its conditions:

```ts
const obsolete =
  current.generation !== generation ||
  currentAttempt?.token !== token ||
  controller.signal.aborted ||
  thrown instanceof ObsoleteAttempt ||
  isAbortError(thrown);
```

By the time this runs, the signal that caused `acquire()` to reject is already aborted, so `controller.signal.aborted` is already true — the rejection is automatically classified as obsolete, silently, exactly like every other abort path today. This is a genuine confirmation the design fits the existing plumbing rather than needing to fight it.

### Configuration surface

`createGraphRuntime` currently takes only a graph: `createGraphRuntime(graph: Graph): GraphRuntime`. This adds a second, optional parameter:

```ts
export interface GraphRuntimeOptions {
  readonly maxConcurrentLoads?: number; // default: unlimited
}

export const createGraphRuntime = (
  graph: Graph,
  options?: GraphRuntimeOptions
): GraphRuntime => { /* ... */ };
```

One limiter instance is constructed once in the composition root (`runtime.ts`) from `options?.maxConcurrentLoads ?? Infinity` and injected into `createRuntimeExecutionController`, the same way every other dependency already is.

## Decisions made, and why (full reasoning in the accompanying ADR)

- **One global limiter, not per-call or per-origin.** A subscription-driven load, a `prefetch()`, and a `refresh()` can all be in flight at the same time from different call sites. If each got its own budget, the total in-flight count could exceed the cap the person actually configured — the whole point is a single shared ceiling across every origin.
- **Fixed at construction, not adjustable afterward.** No `runtime.setMaxConcurrentLoads(n)` in this pass. Handling "what happens to already-queued waiters when the limit changes mid-flight" is real complexity with no concrete need for it yet. Revisit if one shows up.
- **FIFO, not priority-based.** Queued waiters are granted slots in request order. An `"explicit"`-origin load does not jump ahead of a `"scheduler"`-origin one queued earlier. A priority scheme is a plausible future enhancement, not something to guess at now.

## Tests

- Timing test mirroring the empirical check above, but with `maxConcurrentLoads: 2` and 3 pending loads: confirms only 2 run at once and the third starts only once one of the first two completes.
- Abort-while-queued test: a third load queued behind a full limiter, aborted before a slot frees up, never calls its `load()` function and doesn't hold a slot.
- Default-unlimited regression test: confirms `createGraphRuntime(graph)` with no options behaves identically to today (this is largely covered by the existing 98 tests continuing to pass unchanged, since none of them pass options; one explicit test makes the guarantee visible rather than implicit).
- Derived nodes are never gated: a `maxConcurrentLoads: 1` scenario with one in-flight data load and a derived node whose dependencies are already fresh resolves the derived node immediately, not queued behind the data load.

## Non-goals

- No dynamic/runtime-adjustable limit (see above).
- No per-origin priority queue (see above).
- No limiting of `derive()` calls, graph traversal, or anything other than `load()`.
- No relation to Milestone 5's transaction work — orthogonal concerns. Transactions govern when state mutations and notifications become observable; this governs how many loads run at once. Neither depends on the other.

## Where this fits in the roadmap

This is an enhancement to the execution engine built in Milestones 2–3, not tied to any single numbered milestone ahead. It doesn't block, and isn't blocked by, Milestone 4 (Vue adapter) or Milestone 5 (transactions) — added to the roadmap as its own item, sequencing left open rather than assumed.
