# Recipe 09 — Long-running operations with `pollUntil`

**Status:** research-phase pattern  
**Related:** [ADR-012 Refresh policies and polling](../decisions/ADR-012-refresh-policies-and-polling.md), [Events, refresh, and polling](../architecture/04-events-refresh-and-polling.md)

## Failure mode

A server-side operation (report export, async job, provisioning step) doesn't finish in one request. The UI either polls forever with no way out, shows a raw error toast for what's actually a normal "still working" state, or can't tell a real failure apart from "it just took too long this time."

Typical symptoms:

- Spinner never stops if the export gets stuck server-side.
- `timeoutMs` fires and the user sees a generic network-error toast, indistinguishable from the export having actually failed.
- A definitive server-side failure (`status: "failed"`) is treated the same as a timeout, so the retry button offers to "try again" on something that will never succeed.
- Starting a second export while a poll for the previous one is still in flight leaves stale state on screen.

## Rule

Use `pollUntil` on the data node itself — don't hand-rolled a `setInterval` in the component. `stopWhen` and `failWhen` are the only two ways polling ends on its own terms; `timeoutMs` is a third, distinct ending that means "we don't know, we just ran out of patience." Render all three outcomes differently: normal in-progress, definitive failure, and timeout.

## Minimal correct shape

```ts
interface ReportExport {
  readonly id: string;
  readonly status: "queued" | "processing" | "ready" | "failed";
  readonly downloadUrl?: string;
}

const SelectedExportId = defineContextNode<string | null>({
  key: "selectedExportId",
  initialValue: null,
});

const ExportStatus = defineDataNode({
  key: "exportStatus",
  dependencies: [SelectedExportId],
  initialValue: null as ReportExport | null,
  load: ({ get, signal }) => {
    const id = get(SelectedExportId);
    if (id == null) return null;
    return api.exports.get(id, { signal });
  },
  refresh: pollUntil<ReportExport | null>({
    intervalMs: 3_000,
    timeoutMs: 5 * 60_000,
    stopWhen: (report) => report?.status === "ready",
    failWhen: (report) => report?.status === "failed",
  }),
});
```

Rendering the three outcomes:

```vue
<script setup lang="ts">
import { GraphPollingConditionError, GraphPollingTimeoutError } from "vue-dependency-graph/core";
import { useNode } from "vue-dependency-graph/vue";

const { data: report, status, error } = useNode(ExportStatus);
</script>

<template>
  <p v-if="status === 'loading' || report?.status === 'queued' || report?.status === 'processing'">
    Preparing your export…
  </p>
  <a v-else-if="report?.status === 'ready'" :href="report.downloadUrl">Download export</a>
  <p v-else-if="error instanceof GraphPollingConditionError">The export failed. Start a new one.</p>
  <p v-else-if="error instanceof GraphPollingTimeoutError">
    This is taking longer than usual.
    <button @click="runtime.refresh([ExportStatus])">Check again</button>
  </p>
  <p v-else-if="error">Something went wrong.</p>
</template>
```

`GraphPollingConditionError` (from `failWhen`) and `GraphPollingTimeoutError` (from `timeoutMs`) both land on the node's own `error` — same as any other data-node failure, no thrown promise to catch, because this is subscription-driven (`useNode` mounted the subscription; nobody called `execute`/`refresh` explicitly). Distinguish them with `instanceof`, not by inspecting the message string.

If you instead trigger the initial load via an explicit `await runtime.refresh([ExportStatus])` (e.g. a "start export" button before anything is mounted), a timeout or condition failure surfaces as a rejected promise wrapping `GraphExecutionError`, whose `failures` array holds the same two error types — check there rather than assuming a thrown error.

## Common wrong shapes

```ts
// Wrong: refreshInterval for a "wait until done" operation — this never
// stops, so it keeps polling (and paying for requests) long after the
// export is ready or has failed.
refresh: refreshInterval({ intervalMs: 3_000 }),

// Wrong: no failWhen — a server-side "failed" status just looks like an
// export that's still processing, forever, until the timeout eventually
// fires and reports the wrong kind of failure.
refresh: pollUntil({
  intervalMs: 3_000,
  timeoutMs: 5 * 60_000,
  stopWhen: (report) => report?.status === "ready",
  // missing failWhen
}),

// Wrong: treating GraphPollingTimeoutError and GraphPollingConditionError
// as the same case in the UI. A timeout is "we don't know, maybe try
// again"; a condition failure is "the server told us this definitely
// failed" — offering a naive retry on the latter just repeats the failure.
if (error) {
  showGenericRetryToast();
}
```

## Starting a new poll while one is in flight

Changing `SelectedExportId` invalidates `ExportStatus` and starts a fresh poll cycle for the new id — the previous poll's in-flight request is superseded, not left running against stale state. Reset any export-specific local UI state (a progress bar's remembered elapsed time, say) when the id changes; the graph handles the polling lifecycle, not incidental component state layered on top.

## Checklist

- [ ] `pollUntil`, not `refreshInterval`, for anything with a genuine end state.
- [ ] `failWhen` is supplied whenever the server has its own definitive failure status — don't rely on `timeoutMs` to eventually catch it.
- [ ] `GraphPollingConditionError` and `GraphPollingTimeoutError` are rendered differently, not collapsed into one generic error state.
- [ ] A timeout offers a "check again" action (`runtime.refresh(...)`) rather than a dead end.
- [ ] `timeoutMs` is long enough for the slowest realistic case, not just the happy path measured in dev.

## What this recipe does not own

- Server-side job queueing, retry, or backoff — this only covers the client's view of an operation already running server-side.
- Websocket/push-driven completion instead of polling — see [Recipe 05](./05-selective-event-invalidation.md) for invalidating a node from an event instead of a timer.
- Exact `intervalMs`/`timeoutMs` values — tune per operation; a report export and a provisioning step don't share a budget.
