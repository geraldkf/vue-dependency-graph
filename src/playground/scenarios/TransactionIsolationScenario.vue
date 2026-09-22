<template>
  <section aria-labelledby="transaction-isolation-heading">
    <h2 id="transaction-isolation-heading">Transaction Isolation</h2>
    <p>
      Compare two overlapping top-level transaction sessions. Each session owns its staged work and
      outcome, while scheduler work from a committed session proceeds without waiting for the other
      session to close.
    </p>

    <div aria-label="Transaction isolation setup">
      <button :disabled="hasOpenTransaction" @click="startIndependent">
        Start independent transactions
      </button>
      <button :disabled="hasOpenTransaction" @click="startConflict">
        Start shared-context conflict
      </button>
      <button @click="resetScenario">Reset</button>
    </div>

    <p data-testid="transaction-isolation-mode">Mode: {{ snapshot.mode }}</p>
    <p data-testid="transaction-isolation-scheduler">Scheduler: {{ snapshot.schedulerStatus }}</p>
    <p data-testid="transaction-isolation-shared">Shared value: {{ snapshot.sharedValue }}</p>
    <p data-testid="transaction-isolation-conflict">
      Conflict keys: {{ snapshot.conflictKeys.join(", ") || "none" }}
    </p>

    <section aria-labelledby="transaction-isolation-a-heading">
      <h3 id="transaction-isolation-a-heading">Operation A</h3>
      <p data-testid="transaction-isolation-a-phase">Phase: {{ snapshot.operationA.phase }}</p>
      <p data-testid="transaction-isolation-a-value">
        Committed value: {{ snapshot.operationA.committedValue }}
      </p>
      <p data-testid="transaction-isolation-a-requests">
        Dependent requests: {{ snapshot.operationA.requestCount }}
      </p>
      <button :disabled="snapshot.operationA.phase !== 'open'" @click="commitA">
        Commit operation A
      </button>
      <button :disabled="snapshot.operationA.phase !== 'open'" @click="rollbackA">
        Rollback operation A
      </button>
    </section>

    <section aria-labelledby="transaction-isolation-b-heading">
      <h3 id="transaction-isolation-b-heading">Operation B</h3>
      <p data-testid="transaction-isolation-b-phase">Phase: {{ snapshot.operationB.phase }}</p>
      <p data-testid="transaction-isolation-b-value">
        Committed value: {{ snapshot.operationB.committedValue }}
      </p>
      <p data-testid="transaction-isolation-b-requests">
        Dependent requests: {{ snapshot.operationB.requestCount }}
      </p>
      <button :disabled="snapshot.operationB.phase !== 'open'" @click="commitB">
        Commit operation B
      </button>
      <button :disabled="snapshot.operationB.phase !== 'open'" @click="rollbackB">
        Rollback operation B
      </button>
    </section>

    <section aria-labelledby="transaction-isolation-timeline-heading">
      <h3 id="transaction-isolation-timeline-heading">Causal timeline</h3>
      <ol data-testid="transaction-isolation-timeline">
        <li v-for="event in recentEvents" :key="`${event.sequence}-${event.type}`">
          {{ event.sequence }}. {{ event.type }}
          <template v-if="event.operationId"> [{{ event.operationId }}]</template>
          <template v-if="event.causeId"> caused by {{ event.causeId }}</template>
        </li>
      </ol>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import {
  createTransactionIsolationScenario,
  type TransactionIsolationSnapshot,
} from "./transaction-isolation-model";

const scenario = createTransactionIsolationScenario();
let active = true;
const snapshot = ref<TransactionIsolationSnapshot>(scenario.getSnapshot());

const sync = (): void => {
  snapshot.value = scenario.getSnapshot();
};

const hasOpenTransaction = computed(
  () => snapshot.value.operationA.phase === "open" || snapshot.value.operationB.phase === "open",
);
const recentEvents = computed(() => snapshot.value.timeline.slice(-16));

const run = async (action: () => Promise<void>): Promise<void> => {
  await action();
  sync();
};

const startIndependent = (): Promise<void> => run(scenario.startIndependent);
const startConflict = (): Promise<void> => run(scenario.startConflict);
const commitA = (): Promise<void> => run(() => scenario.completeA("commit"));
const rollbackA = (): Promise<void> => run(() => scenario.completeA("rollback"));
const commitB = (): Promise<void> => run(() => scenario.completeB("commit"));
const rollbackB = (): Promise<void> => run(() => scenario.completeB("rollback"));
const resetScenario = (): Promise<void> => run(scenario.reset);

onMounted(async () => {
  await scenario.initialize();
  if (active) sync();
});

onScopeDispose(() => {
  active = false;
  scenario.dispose();
});
</script>
