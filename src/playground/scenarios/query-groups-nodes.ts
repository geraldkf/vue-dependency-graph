import { defineContextNode, defineDataNode, defineDerivedNode, defineQuery } from "../../core";
import { createMockLoader } from "../mock-loader";

export const queryGroupsJobSeekerId = defineContextNode({
  key: "query-groups-job-seeker-id",
  initialValue: 101,
});

export const queryGroupsAppointmentsLoader = createMockLoader({ delayMs: 600 });
export const queryGroupsCapabilityLoader = createMockLoader({ delayMs: 600 });

export const queryGroupsAppointments = defineDataNode({
  key: "query-groups-appointments",
  dependencies: [queryGroupsJobSeekerId] as const,
  initialValue: [] as string[],
  load: ({ get }) =>
    queryGroupsAppointmentsLoader.load(() => [
      `Appointment ${queryGroupsAppointmentsLoader.callCount.value} for ${get(queryGroupsJobSeekerId)}`,
    ]),
});

export const queryGroupsCapabilityStatus = defineDataNode({
  key: "query-groups-capability-status",
  dependencies: [queryGroupsJobSeekerId] as const,
  initialValue: "Not loaded",
  load: ({ get }) =>
    queryGroupsCapabilityLoader.load(
      () =>
        `Capability request ${queryGroupsCapabilityLoader.callCount.value} for ${get(queryGroupsJobSeekerId)}`,
    ),
});

export const queryGroupsSummary = defineDerivedNode({
  key: "query-groups-summary",
  dependencies: [queryGroupsAppointments, queryGroupsCapabilityStatus] as const,
  derive: ({ get }) =>
    `${get(queryGroupsAppointments).length} appointment; ${get(queryGroupsCapabilityStatus)}`,
});

export const queryGroupsPage = defineQuery({
  key: "query-groups-page",
  nodes: {
    jobSeeker: queryGroupsJobSeekerId,
    appointments: queryGroupsAppointments,
    capabilityStatus: queryGroupsCapabilityStatus,
    summary: queryGroupsSummary,
  },
});
