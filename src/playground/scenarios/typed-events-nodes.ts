import { ref } from "vue";
import {
  defineContextNode,
  defineDataNode,
  type EventInvalidationContext,
} from "../../core";
import { appointmentBooked } from "./appointments-domain";

export const capabilityJobSeekerId = defineContextNode({
  key: "typed-events.job-seeker-id",
  initialValue: 101,
});

const requestCount = ref(0);

export const capabilityStatusLoader = {
  requestCount,
  reset: (): void => {
    requestCount.value = 0;
  },
};

export const capabilityInterviewStatus = defineDataNode({
  key: "typed-events.capability-status",
  dependencies: [capabilityJobSeekerId] as const,
  invalidatedBy: [{
    event: appointmentBooked,
    when: ({ payload, get }: EventInvalidationContext<
      typeof appointmentBooked,
      readonly [typeof capabilityJobSeekerId]
    >) => payload.jobSeekerId === get(capabilityJobSeekerId),
  }] as const,
  initialValue: "Not loaded",
  load: async ({ get }) => {
    capabilityStatusLoader.requestCount.value += 1;
    return `Current for job seeker ${get(capabilityJobSeekerId)} (request ${capabilityStatusLoader.requestCount.value})`;
  },
});
