<template>
  <section aria-labelledby="optimistic-booking-heading">
    <h2 id="optimistic-booking-heading">Optimistic Appointment Booking</h2>
    <p>
      Shows immediate optimistic data, confirmed reconciliation, safe rollback,
      and unknown-outcome recovery through the Pinia-owned runtime.
    </p>

    <div>
      <button :disabled="isSubmitting" @click="startBooking">
        Start booking
      </button>
      <button :disabled="!isSubmitting" @click="confirmBooking">
        Confirm success
      </button>
      <button :disabled="!isSubmitting" @click="rejectBooking">
        Reject booking
      </button>
      <button :disabled="!isSubmitting" @click="makeOutcomeUnknown">
        Make outcome unknown
      </button>
      <button :disabled="!isSubmitting" @click="startOverlappingBooking">
        Start overlapping booking
      </button>
      <button @click="resetScenario">Reset</button>
    </div>

    <p data-testid="optimistic-booking-phase">Phase: {{ phase }}</p>
    <p data-testid="optimistic-booking-outcome">Outcome: {{ outcome }}</p>
    <p data-testid="optimistic-booking-error">
      Error: {{ errorMessage ?? "none" }}
    </p>
    <p data-testid="optimistic-booking-requests">
      Booking requests: {{ optimisticAppointmentApi.requestCount.value }}
    </p>
    <p data-testid="optimistic-booking-state">
      Appointments: {{ appointments.status.value }} / {{ appointments.freshness.value }}
    </p>
    <p data-testid="optimistic-booking-capability">
      Capability: {{ capability.data.value }}
    </p>
    <p data-testid="optimistic-booking-capability-requests">
      Capability requests: {{ capabilityStatusLoader.requestCount.value }}
    </p>

    <ul aria-label="Appointments">
      <li v-for="appointment in appointments.data.value" :key="appointment.clientId">
        {{ appointment.clientId }}: {{ appointment.status }}
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import {
  GraphMutationConflictError,
  GraphMutationOutcomeUnknownError,
} from "../../core";
import { useNode } from "../../vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import { appointmentBooked } from "./appointments-domain";
import {
  bookAppointment,
  isKnownBookingRejection,
  optimisticAppointmentApi,
  optimisticAppointments,
  type BookAppointmentInput,
} from "./optimistic-appointment-nodes";
import {
  capabilityInterviewStatus,
  capabilityJobSeekerId,
  capabilityStatusLoader,
} from "./typed-events-nodes";

const runtime = useDependencyGraphStore().runtime;
const appointments = useNode(optimisticAppointments, { runtime });
const capability = useNode(capabilityInterviewStatus, { runtime });

const phase = ref<
  "ready" | "submitting" | "optimistic" | "confirmed" | "rolled-back" | "unknown"
>("ready");
const outcome = ref("ready");
const errorMessage = ref<string | null>(null);
const nextClientId = ref(1);
let activeBooking: Promise<void> | undefined;
const isSubmitting = computed(() =>
  phase.value === "submitting" || phase.value === "optimistic"
);

const runBooking = async (input: BookAppointmentInput): Promise<void> => {
  phase.value = "submitting";
  outcome.value = "request started";
  errorMessage.value = null;

  try {
    await runtime.mutate(bookAppointment, input, {
      optimistic: effects => {
        effects.update(optimisticAppointments, current => [
          ...current,
          {
            id: -nextClientId.value,
            clientId: input.clientId,
            jobSeekerId: input.jobSeekerId,
            status: "pending",
          },
        ]);
        phase.value = "optimistic";
        outcome.value = "optimistic appointment visible";
      },
      onSuccess: (effects, saved) => {
        effects.update(optimisticAppointments, current =>
          current.map(appointment =>
            appointment.clientId === saved.clientId ? saved : appointment
          )
        );
        effects.publish(appointmentBooked, {
          jobSeekerId: saved.jobSeekerId,
          appointmentId: saved.id,
        });
      },
      classifyFailure: error =>
        isKnownBookingRejection(error) ? "rejected" : "unknown",
    });
    phase.value = "confirmed";
    outcome.value = "booking confirmed";
  } catch (error) {
    if (error instanceof GraphMutationConflictError) {
      outcome.value = "overlapping booking rejected";
      errorMessage.value = error.message;
      return;
    }
    if (error instanceof GraphMutationOutcomeUnknownError) {
      phase.value = "unknown";
      outcome.value = "remote outcome unknown; authoritative reload requested";
      errorMessage.value = error.message;
      return;
    }
    phase.value = "rolled-back";
    outcome.value = "booking rejected and rolled back";
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
};

const startBooking = (): void => {
  const input = {
    clientId: `pending-${nextClientId.value++}`,
    jobSeekerId: runtime.getState(capabilityJobSeekerId).data,
  };
  activeBooking = runBooking(input).finally(() => {
    activeBooking = undefined;
  });
};

const startOverlappingBooking = async (): Promise<void> => {
  const input = {
    clientId: `overlap-${nextClientId.value++}`,
    jobSeekerId: runtime.getState(capabilityJobSeekerId).data,
  };

  try {
    await runtime.mutate(bookAppointment, input, {
      optimistic: effects => {
        effects.update(optimisticAppointments, current => [
          ...current,
          {
            id: -nextClientId.value,
            clientId: input.clientId,
            jobSeekerId: input.jobSeekerId,
            status: "pending",
          },
        ]);
      },
    });
  } catch (error) {
    if (error instanceof GraphMutationConflictError) {
      outcome.value = "overlapping booking rejected";
      errorMessage.value = error.message;
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
};

const confirmBooking = (): void => optimisticAppointmentApi.confirm();
const rejectBooking = (): void => optimisticAppointmentApi.reject();
const makeOutcomeUnknown = (): void => optimisticAppointmentApi.makeUnknown();

const resetScenario = async (): Promise<void> => {
  optimisticAppointmentApi.releasePending();
  await activeBooking;
  optimisticAppointmentApi.reset();
  capabilityStatusLoader.reset();
  phase.value = "ready";
  outcome.value = "ready";
  errorMessage.value = null;
  nextClientId.value = 1;
  await runtime.refresh([optimisticAppointments, capabilityInterviewStatus]);
};

onScopeDispose(() => {
  optimisticAppointmentApi.releasePending();
});
</script>
