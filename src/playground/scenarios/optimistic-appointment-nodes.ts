import { ref } from "vue";
import {
  defineDataNode,
  defineMutation,
  type MutationExecuteContext,
} from "../../core";
import { capabilityJobSeekerId } from "./typed-events-nodes";

export interface PlaygroundAppointment {
  readonly id: number;
  readonly clientId: string;
  readonly jobSeekerId: number;
  readonly status: "confirmed" | "pending";
}

export interface BookAppointmentInput {
  readonly clientId: string;
  readonly jobSeekerId: number;
}

export interface BookAppointmentResult {
  readonly id: number;
  readonly clientId: string;
  readonly jobSeekerId: number;
  readonly status: "confirmed";
}

class KnownBookingRejection extends Error {
  public constructor() {
    super("Appointment booking was rejected.");
    this.name = "KnownBookingRejection";
  }
}

class UnknownBookingOutcome extends Error {
  public constructor() {
    super("Appointment booking outcome is unknown.");
    this.name = "UnknownBookingOutcome";
  }
}

interface PendingBooking {
  readonly resolve: (value: BookAppointmentResult) => void;
  readonly reject: (reason: Error) => void;
  readonly input: BookAppointmentInput;
}

const initialAppointments = (): PlaygroundAppointment[] => [{
  id: 1,
  clientId: "confirmed-1",
  jobSeekerId: 101,
  status: "confirmed",
}];

const appointmentRequestCount = ref(0);
let nextAppointmentId = 2;
let pending: PendingBooking | undefined;

export const optimisticAppointmentApi = {
  requestCount: appointmentRequestCount,
  hasPending: (): boolean => pending !== undefined,
  confirm: (): void => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    current.resolve({
      id: nextAppointmentId++,
      clientId: current.input.clientId,
      jobSeekerId: current.input.jobSeekerId,
      status: "confirmed",
    });
  },
  reject: (): void => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    current.reject(new KnownBookingRejection());
  },
  makeUnknown: (): void => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    current.reject(new UnknownBookingOutcome());
  },
  releasePending: (): void => {
    const current = pending;
    if (!current) return;
    pending = undefined;
    current.reject(new UnknownBookingOutcome());
  },
  reset: (): void => {
    appointmentRequestCount.value = 0;
    nextAppointmentId = 2;
    pending = undefined;
  },
};

export const optimisticAppointments = defineDataNode({
  key: "optimistic-booking.appointments",
  dependencies: [capabilityJobSeekerId] as const,
  initialValue: [] as PlaygroundAppointment[],
  load: async () => initialAppointments(),
});

export const bookAppointment = defineMutation({
  key: "optimistic-booking.book",
  execute: ({ input }: MutationExecuteContext<BookAppointmentInput>) => {
    appointmentRequestCount.value += 1;
    return new Promise<BookAppointmentResult>((resolve, reject) => {
      pending = { input, resolve, reject };
    });
  },
});

export const isKnownBookingRejection = (error: unknown): boolean =>
  error instanceof KnownBookingRejection;
