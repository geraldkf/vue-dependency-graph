<template>
  <section aria-label="Error and retry scenario">
    <h2>Error and Retry</h2>
    <p>
      <label>
        <input type="checkbox" v-model="flakyLoader.shouldFail.value" />
        Make the next load fail
      </label>
    </p>
    <p>
      <button @click="handleRefresh">Refresh</button>
    </p>
    <p data-testid="status">Status: {{ resource.status.value }}</p>
    <p data-testid="data">Data: {{ resource.data.value || "(none yet)" }}</p>
    <p data-testid="error">Error: {{ resource.error.value?.message ?? "(none)" }}</p>
  </section>
</template>

<script setup lang="ts">
// Deliberately shows data and error together, not one-or-the-other — a
// refresh failure leaves the previous successful data readable alongside
// the new error, and this scenario exists specifically to make that
// visible rather than have the UI hide the stale data once an error
// appears.
import { useNode } from "../../vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import { flakyLoader, flakyResource } from "./error-and-retry-nodes";

const { runtime } = useDependencyGraphStore();
const resource = useNode(flakyResource, { runtime });

const handleRefresh = (): void => {
  // refresh() rejects when the batch fails, on top of recording the
  // failure in the node's own reactive state (which resource.error /
  // resource.status already reflect). A plain @click="runtime.refresh(...)"
  // leaves that rejection with nothing to handle it — a genuine unhandled
  // promise rejection, not just a lint nitpick. The reactive state is
  // already the source of truth for this UI, so there's deliberately
  // nothing more to do here.
  void runtime.refresh([flakyResource]).catch(() => {});
};
</script>
