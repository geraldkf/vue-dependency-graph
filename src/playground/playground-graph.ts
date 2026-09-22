import { createGraph } from "../core";
import { metricA, metricB, metricC } from "./scenarios/aggregate-query-nodes";
import { sharedResource } from "./scenarios/concurrent-consumers-nodes";
import { selectedUserId, userProfile } from "./scenarios/context-switching-nodes";
import { flakyResource } from "./scenarios/error-and-retry-nodes";
import { optimisticAppointments } from "./scenarios/optimistic-appointment-nodes";
import { toggleableResource } from "./scenarios/unmount-cleanup-nodes";
import {
  capabilityInterviewStatus,
  capabilityJobSeekerId,
  unrelatedAppointmentStatus,
} from "./scenarios/typed-events-nodes";
import {
  queryGroupsAppointments,
  queryGroupsCapabilityStatus,
  queryGroupsJobSeekerId,
  queryGroupsSummary,
} from "./scenarios/query-groups-nodes";

/**
 * One graph shared by the playground's Pinia-owned runtime.
 * Scenario node keys are namespaced so all scenarios can coexist safely.
 */
export const playgroundGraph = createGraph({
  nodes: [
    selectedUserId,
    userProfile,
    sharedResource,
    flakyResource,
    toggleableResource,
    metricA,
    metricB,
    metricC,
    capabilityJobSeekerId,
    capabilityInterviewStatus,
    unrelatedAppointmentStatus,
    optimisticAppointments,
    queryGroupsJobSeekerId,
    queryGroupsAppointments,
    queryGroupsCapabilityStatus,
    queryGroupsSummary,
  ],
});
