import {
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  type EventInvalidationContext,
  type EventPayload,
  type NodeValue,
} from "../../src/core";

const count = defineContextNode({ key: "count", initialValue: 1 });
const label = defineContextNode({ key: "label", initialValue: "items" });
const other = defineContextNode({ key: "other", initialValue: true });

const data = defineDataNode({
  key: "data",
  dependencies: [count, label] as const,
  initialValue: "",
  load: async ({ get }) => {
    const countValue: number = get(count);
    const labelValue: string = get(label);
    // @ts-expect-error other is not a declared dependency
    get(other);
    return `${labelValue}:${countValue}`;
  },
});

// Prefixed with `_`: only exercised via `typeof _derived` below for the
// static NodeValue<> type check, not read as a runtime value.
const _derived = defineDerivedNode({
  key: "derived",
  dependencies: [count, data] as const,
  derive: ({ get }) => {
    const countValue: number = get(count);
    const dataValue: string = get(data);
    return `${dataValue}:${countValue}`;
  },
});

const contextValue: NodeValue<typeof count> = 1;
const dataValue: NodeValue<typeof data> = "value";
const derivedValue: NodeValue<typeof _derived> = "value";
void [contextValue, dataValue, derivedValue];

void defineDataNode<number>({
  key: "invalid-data",
  initialValue: 0,
  // @ts-expect-error data loader must return the declared number value
  load: async () => "wrong",
});

void defineDerivedNode<number, readonly [typeof count]>({
  key: "invalid-derived",
  dependencies: [count] as const,
  // @ts-expect-error explicit derived value type must match the derive result
  derive: () => "wrong",
});

const appointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");

type AppointmentBookedPayload = EventPayload<typeof appointmentBooked>;
const appointmentPayload: AppointmentBookedPayload = {
  jobSeekerId: 123,
  appointmentId: 456,
};
void appointmentPayload;

const eventInvalidatedData = defineDataNode({
  key: "event-invalidated-data",
  dependencies: [count] as const,
  invalidatedBy: [
    appointmentBooked,
    {
      event: appointmentBooked,
      when: ({
        payload,
        get,
      }: EventInvalidationContext<typeof appointmentBooked, readonly [typeof count]>) => {
        const jobSeekerId: number = payload.jobSeekerId;
        const currentCount: number = get(count);
        // @ts-expect-error event predicates can read only declared dependencies
        get(other);
        return jobSeekerId === currentCount;
      },
    },
  ] as const,
  initialValue: "",
  load: async () => "value",
});

const eventInvalidatedDerived = defineDerivedNode({
  key: "event-invalidated-derived",
  dependencies: [eventInvalidatedData] as const,
  invalidatedBy: [appointmentBooked] as const,
  derive: ({ get }) => get(eventInvalidatedData),
});

void [eventInvalidatedData, eventInvalidatedDerived];

const invalidAppointmentPayload: AppointmentBookedPayload = {
  // @ts-expect-error event payload fields retain their declared types
  jobSeekerId: "invalid",
  appointmentId: 456,
};
void invalidAppointmentPayload;

defineContextNode({
  key: "invalid-event-context",
  initialValue: 1,
  // @ts-expect-error context nodes do not support event invalidation declarations
  invalidatedBy: [appointmentBooked],
});
