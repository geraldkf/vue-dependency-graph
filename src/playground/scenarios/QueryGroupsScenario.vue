<template>
  <section aria-label="Query groups scenario">
    <h2>Query Groups</h2>
    <p>
      One aliased query definition drives prefetch, component subscription,
      aggregate state, and refresh.
    </p>

    <p>
      <button :disabled="isBusy" @click="handlePrefetch">Prefetch page</button>
      <button @click="showConsumer = !showConsumer">
        {{ showConsumer ? "Unmount consumer" : "Mount consumer" }}
      </button>
    </p>

    <p data-testid="query-groups-prefetch-outcome">
      Prefetch outcome: {{ prefetchOutcome }}
    </p>
    <p data-testid="query-groups-request-counts">
      Requests: appointments {{ queryGroupsAppointmentsLoader.callCount.value }},
      capability {{ queryGroupsCapabilityLoader.callCount.value }}
    </p>
    <p data-testid="query-groups-subscriptions">
      Direct subscriptions: appointments {{ showConsumer ? 1 : 0 }},
      capability {{ showConsumer ? 1 : 0 }}
    </p>

    <QueryGroupsConsumer v-if="showConsumer" @busy="isBusy = $event" />
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import QueryGroupsConsumer from "./QueryGroupsConsumer.vue";
import {
  queryGroupsAppointmentsLoader,
  queryGroupsCapabilityLoader,
  queryGroupsPage,
} from "./query-groups-nodes";

const { runtime } = useDependencyGraphStore();
const showConsumer = ref(false);
const isBusy = ref(false);
const prefetchOutcome = ref("not run");

const handlePrefetch = async (): Promise<void> => {
  isBusy.value = true;
  prefetchOutcome.value = "running";
  try {
    await runtime.prefetchQuery(queryGroupsPage);
    prefetchOutcome.value = "ready";
  } catch (error) {
    prefetchOutcome.value = error instanceof Error ? error.message : String(error);
  } finally {
    isBusy.value = false;
  }
};
</script>
