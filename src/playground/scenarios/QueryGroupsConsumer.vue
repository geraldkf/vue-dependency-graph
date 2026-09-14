<template>
  <section aria-label="Query groups consumer">
    <h3>Page consumer</h3>
    <p data-testid="query-groups-job-seeker">
      Job seeker: {{ page.nodes.jobSeeker.data.value }}
    </p>
    <p data-testid="query-groups-appointments">
      Appointments: {{ page.nodes.appointments.data.value.join(", ") || "(none)" }}
    </p>
    <p data-testid="query-groups-capability">
      Capability: {{ page.nodes.capabilityStatus.data.value }}
    </p>
    <p data-testid="query-groups-summary">
      Summary: {{ page.nodes.summary.data.value ?? "Not calculated" }}
    </p>
    <p data-testid="query-groups-aggregate">
      Loading: {{ page.isLoading.value }}; error: {{ page.isError.value }};
      success: {{ page.isSuccess.value }}
    </p>
    <p>
      <button :disabled="busy" @click="handleRefresh">Refresh page</button>
    </p>
    <p data-testid="query-groups-refresh-outcome">
      Refresh outcome: {{ refreshOutcome }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useQuery } from "../../vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import { queryGroupsPage } from "./query-groups-nodes";

const emit = defineEmits<{
  busy: [value: boolean];
}>();

const { runtime } = useDependencyGraphStore();
const page = useQuery(queryGroupsPage, { runtime });
const busy = ref(false);
const refreshOutcome = ref("not run");

const handleRefresh = async (): Promise<void> => {
  busy.value = true;
  emit("busy", true);
  refreshOutcome.value = "running";
  try {
    await page.refresh();
    refreshOutcome.value = "ready";
  } catch (error) {
    refreshOutcome.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
    emit("busy", false);
  }
};
</script>
