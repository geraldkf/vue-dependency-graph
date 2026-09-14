<template>
  <section aria-label="Typed events scenario">
    <h2>Typed Events</h2>
    <p>
      The Appointments domain publishes a typed event. The Compliance node
      decides whether its capability status is affected without either domain
      importing the other's store implementation.
    </p>

    <p data-testid="typed-events-context">
      Current job seeker: {{ jobSeekerId.data.value }}
    </p>
    <p data-testid="typed-events-status">
      Capability status: {{ capabilityStatus.data.value }}
    </p>
    <p data-testid="typed-events-node-state">
      Node: {{ capabilityStatus.status.value }} / {{ capabilityStatus.freshness.value }}
    </p>
    <p data-testid="typed-events-request-count">
      Requests: {{ capabilityStatusLoader.requestCount.value }}
    </p>
    <p data-testid="typed-events-outcome">Outcome: {{ outcome }}</p>

    <label>
      Event job seeker
      <input v-model.number="eventJobSeekerId" type="number" />
    </label>

    <p>
      <button @click="publishMatching">Publish matching event</button>
      <button @click="publishNonMatching">Publish non-matching event</button>
      <button :disabled="transactionPhase !== 'idle'" @click="startTransaction">
        Start event transaction
      </button>
      <button :disabled="transactionPhase !== 'staged'" @click="commitTransaction">
        Commit event transaction
      </button>
      <button :disabled="transactionPhase !== 'staged'" @click="rollbackTransaction">
        Rollback event transaction
      </button>
      <button @click="resetScenario">Reset</button>
    </p>

    <p data-testid="typed-events-transaction-phase">
      Transaction: {{ transactionPhase }}
    </p>
    <ol aria-label="Typed event history">
      <li v-for="entry in history" :key="entry.id">{{ entry.message }}</li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { onScopeDispose, ref } from "vue";
import { useNode } from "../../vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import {
  capabilityInterviewStatus,
  capabilityJobSeekerId,
  capabilityStatusLoader,
} from "./typed-events-nodes";
import { publishAppointmentBooked } from "./appointments-domain";

interface HistoryEntry {
  readonly id: number;
  readonly message: string;
}

type TransactionDecision = "commit" | "rollback";
type TransactionPhase = "idle" | "staged" | "committed" | "rolled-back";

const { runtime } = useDependencyGraphStore();
const jobSeekerId = useNode(capabilityJobSeekerId, { runtime });
const capabilityStatus = useNode(capabilityInterviewStatus, { runtime });
const eventJobSeekerId = ref(runtime.getState(capabilityJobSeekerId).data);
const outcome = ref("ready");
const transactionPhase = ref<TransactionPhase>("idle");
const history = ref<HistoryEntry[]>([]);
let nextHistoryId = 1;
let resolveDecision: ((decision: TransactionDecision) => void) | undefined;
let isMounted = true;

const record = (message: string): void => {
  history.value.push({ id: nextHistoryId, message });
  nextHistoryId += 1;
};

const waitForRuntime = async (): Promise<void> => {
  await runtime.whenSettled();
};

const publishMatching = async (): Promise<void> => {
  eventJobSeekerId.value = runtime.getState(capabilityJobSeekerId).data;
  publishAppointmentBooked(runtime, {
    jobSeekerId: eventJobSeekerId.value,
    appointmentId: nextHistoryId,
  });
  record(`Published matching appointment for ${eventJobSeekerId.value}`);
  await waitForRuntime();
  if (isMounted) outcome.value = "matching event reloaded capability status";
};

const publishNonMatching = async (): Promise<void> => {
  eventJobSeekerId.value = runtime.getState(capabilityJobSeekerId).data + 1;
  publishAppointmentBooked(runtime, {
    jobSeekerId: eventJobSeekerId.value,
    appointmentId: nextHistoryId,
  });
  record(`Published non-matching appointment for ${eventJobSeekerId.value}`);
  await waitForRuntime();
  if (isMounted) outcome.value = "non-matching event ignored";
};

const startTransaction = (): void => {
  transactionPhase.value = "staged";
  outcome.value = "event staged; committed capability state is unchanged";

  void runtime.transaction(async () => {
    publishAppointmentBooked(runtime, {
      jobSeekerId: runtime.getState(capabilityJobSeekerId).data,
      appointmentId: nextHistoryId,
    });
    record("Staged matching appointment event");

    const decision = await new Promise<TransactionDecision>(resolve => {
      resolveDecision = resolve;
    });
    if (decision === "rollback") {
      throw new Error("Typed event transaction rollback");
    }
  }).then(async () => {
    await waitForRuntime();
    if (!isMounted) return;
    transactionPhase.value = "committed";
    outcome.value = "staged event committed and capability status reloaded";
    record("Committed staged appointment event");
  }).catch((error: unknown) => {
    if (!isMounted) return;
    transactionPhase.value = "rolled-back";
    outcome.value = error instanceof Error ? error.message : "Transaction rolled back";
    record("Rolled back staged appointment event");
  }).finally(() => {
    resolveDecision = undefined;
  });
};

const commitTransaction = (): void => {
  resolveDecision?.("commit");
  resolveDecision = undefined;
};

const rollbackTransaction = (): void => {
  resolveDecision?.("rollback");
  resolveDecision = undefined;
};

const resetScenario = async (): Promise<void> => {
  resolveDecision?.("rollback");
  resolveDecision = undefined;
  await runtime.transaction(() => {
    runtime.setContext(capabilityJobSeekerId, 101);
  }).catch(() => {});
  capabilityStatusLoader.reset();
  await runtime.refresh([capabilityInterviewStatus]).catch(() => {});
  await waitForRuntime();
  eventJobSeekerId.value = 101;
  outcome.value = "ready";
  transactionPhase.value = "idle";
  history.value = [];
  nextHistoryId = 1;
};

onScopeDispose(() => {
  isMounted = false;
  resolveDecision?.("rollback");
  resolveDecision = undefined;
});
</script>
