import {
  defineEvent,
  type GraphRuntime,
} from "../../core";

export const appointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");

export const publishAppointmentBooked = (
  runtime: GraphRuntime,
  payload: {
    readonly jobSeekerId: number;
    readonly appointmentId: number;
  }
): void => {
  runtime.publish(appointmentBooked, payload);
};
