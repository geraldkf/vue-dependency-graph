import {
  defineEvent,
  type GraphRuntime,
} from "../../core";

export const appointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");

export const publishAppointmentBooked = (
  publisher: Pick<GraphRuntime, "publish">,
  payload: {
    readonly jobSeekerId: number;
    readonly appointmentId: number;
  }
): void => {
  publisher.publish(appointmentBooked, payload);
};
