<template>
  <main>
    <h1>Vue Dependency Graph</h1>
    <p>Pinia-owned graph runtime playground</p>

    <nav aria-label="Playground scenarios">
      <button
        v-for="scenario in scenarios"
        :key="scenario.id"
        :aria-pressed="activeScenarioId === scenario.id"
        @click="activeScenarioId = scenario.id"
      >
        {{ scenario.label }}
      </button>
    </nav>

    <component :is="activeScenario.component" />
  </main>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import AggregateQueryScenario from "./scenarios/AggregateQueryScenario.vue";
import AtomicTransactionScenario from "./scenarios/AtomicTransactionScenario.vue";
import ConcurrentConsumersScenario from "./scenarios/ConcurrentConsumersScenario.vue";
import ConcurrencyLimitScenario from "./scenarios/ConcurrencyLimitScenario.vue";
import ContextSwitchingScenario from "./scenarios/ContextSwitchingScenario.vue";
import ErrorAndRetryScenario from "./scenarios/ErrorAndRetryScenario.vue";
import UnmountCleanupScenario from "./scenarios/UnmountCleanupScenario.vue";
import TypedEventsScenario from "./scenarios/TypedEventsScenario.vue";
import QueryGroupsScenario from "./scenarios/QueryGroupsScenario.vue";
import PollingProgressScenario from "./scenarios/PollingProgressScenario.vue";
import OptimisticAppointmentBookingScenario from "./scenarios/OptimisticAppointmentBookingScenario.vue";
import RuntimeObservabilityScenario from "./scenarios/RuntimeObservabilityScenario.vue";

interface PlaygroundScenario {
  readonly id: string;
  readonly label: string;
  readonly component: Component;
}

const scenarios = [
  {
    id: "context-switching",
    label: "Context Switching",
    component: ContextSwitchingScenario,
  },
  {
    id: "atomic-transaction",
    label: "Atomic Transaction",
    component: AtomicTransactionScenario,
  },
  {
    id: "typed-events",
    label: "Typed Events",
    component: TypedEventsScenario,
  },
  {
    id: "optimistic-appointment-booking",
    label: "Optimistic Appointment Booking",
    component: OptimisticAppointmentBookingScenario,
  },
  {
    id: "concurrent-consumers",
    label: "Concurrent Consumers",
    component: ConcurrentConsumersScenario,
  },
  {
    id: "concurrency-limit",
    label: "Concurrency Limit",
    component: ConcurrencyLimitScenario,
  },
  {
    id: "error-and-retry",
    label: "Error and Retry",
    component: ErrorAndRetryScenario,
  },
  {
    id: "unmount-cleanup",
    label: "Unmount Cleanup",
    component: UnmountCleanupScenario,
  },
  {
    id: "aggregate-query",
    label: "Aggregate Query",
    component: AggregateQueryScenario,
  },
  {
    id: "query-groups",
    label: "Query Groups",
    component: QueryGroupsScenario,
  },
  {
    id: "polling-progress",
    label: "Polling Progress",
    component: PollingProgressScenario,
  },
  {
    id: "runtime-observability",
    label: "Runtime Observability",
    component: RuntimeObservabilityScenario,
  },
] as const satisfies readonly PlaygroundScenario[];

type PlaygroundScenarioId = (typeof scenarios)[number]["id"];

const activeScenarioId = ref<PlaygroundScenarioId>(scenarios[0].id);
const activeScenario = computed(
  () =>
    scenarios.find(scenario => scenario.id === activeScenarioId.value) ??
    scenarios[0]
);
</script>
