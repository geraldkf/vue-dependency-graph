<template>
  <section aria-labelledby="runtime-observability-heading">
    <h2 id="runtime-observability-heading">Runtime Observability</h2>
    <p>
      Run deterministic graph actions and inspect their causal event timeline,
      metrics, and safely redacted snapshot without using console logging.
    </p>

    <p data-testid="observability-case">Selected case: {{ selectedCase }}</p>
    <p data-testid="observability-summary">Summary: {{ summary }}</p>
    <p data-testid="observability-outcome">Last action: {{ lastAction }}</p>

    <div aria-label="Observability controls">
      <button @click="changeContext">Change context</button>
      <button @click="runRefresh">Refresh</button>
      <button @click="runFailure">Fail next request</button>
      <button @click="runRecovery">Recover</button>
      <button @click="runRollback">Run transaction rollback</button>
      <button @click="runMutation">Run mutation</button>
      <button @click="exportSnapshot">Export snapshot</button>
      <button @click="resetScenario">Reset</button>
    </div>

    <section aria-labelledby="observability-metrics-heading">
      <h3 id="observability-metrics-heading">Metrics</h3>
      <p data-testid="observability-event-count">
        Events received: {{ metrics.eventCount }}
      </p>
      <p data-testid="observability-load-count">
        Successful node attempts: {{ successfulAttempts }}
      </p>
      <p data-testid="observability-mutation-count">
        Successful mutations: {{ metrics.mutations.succeeded }}
      </p>
      <p data-testid="observability-rollback-count">
        Transaction rollbacks: {{ metrics.transactions.rolledBack }}
      </p>
    </section>

    <section aria-labelledby="observability-timeline-heading">
      <h3 id="observability-timeline-heading">Recent event timeline</h3>
      <ol data-testid="observability-timeline">
        <li v-for="event in recentEvents" :key="`${event.sequence}-${event.type}`">
          {{ event.sequence }}. {{ event.type }}
          <template v-if="event.operationId"> [{{ event.operationId }}]</template>
          <template v-if="event.causeId"> caused by {{ event.causeId }}</template>
        </li>
      </ol>
    </section>

    <section aria-labelledby="observability-snapshot-heading">
      <h3 id="observability-snapshot-heading">Redacted snapshot preview</h3>
      <pre data-testid="observability-snapshot">{{ snapshotPreview }}</pre>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import type { GraphDiagnosticEvent, GraphMetricsSnapshot } from "../../core";
import {
  createRuntimeObservabilityScenario,
  type RuntimeObservabilityScenario,
} from "./runtime-observability-model";

const scenario = ref<RuntimeObservabilityScenario>(
  createRuntimeObservabilityScenario(),
);
const version = ref(0);
const lastAction = ref("initial subscription");

const refreshView = (): void => {
  version.value += 1;
};

const selectedCase = computed(() => {
  void version.value;
  return scenario.value.getSelectedCase();
});
const summary = computed(() => {
  void version.value;
  return scenario.value.getSummary();
});
const metrics = computed<GraphMetricsSnapshot>(() => {
  void version.value;
  return scenario.value.getMetrics();
});
const recentEvents = computed<readonly GraphDiagnosticEvent[]>(() => {
  void version.value;
  return scenario.value.getEvents().slice(-12);
});
const snapshotPreview = computed(() => {
  void version.value;
  return scenario.value.getSnapshotPreview();
});
const successfulAttempts = computed(() =>
  metrics.value.nodeAttempts.reduce(
    (total, attempt) => total + attempt.succeeded,
    0,
  ),
);

const runAction = async (
  label: string,
  action: () => Promise<void>,
): Promise<void> => {
  await action();
  lastAction.value = label;
  refreshView();
};

const changeContext = (): Promise<void> =>
  runAction("context changed", () =>
    scenario.value.setSelectedCase("case-200"),
  );
const runRefresh = (): Promise<void> =>
  runAction("explicit refresh", scenario.value.refresh);
const runFailure = (): Promise<void> =>
  runAction("request failed", scenario.value.failNextRequest);
const runRecovery = (): Promise<void> =>
  runAction("request recovered", scenario.value.recover);
const runRollback = (): Promise<void> =>
  runAction("transaction rolled back", scenario.value.runTransactionRollback);
const runMutation = (): Promise<void> =>
  runAction("mutation completed", scenario.value.runMutation);

const exportSnapshot = (): void => {
  const anchor = document.createElement("a");
  anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(snapshotPreview.value)}`;
  anchor.download = "runtime-observability.json";
  anchor.click();
  lastAction.value = "snapshot exported";
};

const resetScenario = async (): Promise<void> => {
  scenario.value.dispose();
  scenario.value = createRuntimeObservabilityScenario();
  await scenario.value.runtime.whenSettled();
  lastAction.value = "reset";
  refreshView();
};

onMounted(async () => {
  await scenario.value.runtime.whenSettled();
  refreshView();
});

onScopeDispose(() => {
  scenario.value.dispose();
});
</script>
