import type { ComputedRef } from "vue";
import { defineContextNode, defineDataNode, defineQuery } from "../../src/core";
import { useQuery } from "../../src/vue";

const jobSeekerId = defineContextNode({
  key: "use-query-types-job-seeker-id",
  initialValue: 101,
});

const appointments = defineDataNode({
  key: "use-query-types-appointments",
  dependencies: [jobSeekerId] as const,
  initialValue: [] as string[],
  load: async () => ["appointment"],
});

const appointmentsPage = defineQuery({
  key: "use-query-types-appointments-page",
  nodes: {
    currentJobSeeker: jobSeekerId,
    appointments,
  },
});

const result = useQuery(appointmentsPage);

const currentJobSeeker: ComputedRef<number> = result.nodes.currentJobSeeker.data;
const appointmentList: ComputedRef<string[]> = result.nodes.appointments.data;
const isLoading: ComputedRef<boolean> = result.isLoading;
const prefetchResult: Promise<void> = result.prefetch();
const refreshResult: Promise<void> = result.refresh();
void [currentJobSeeker, appointmentList, isLoading, prefetchResult, refreshResult];

// @ts-expect-error query aliases are retained exactly
result.nodes.missing;

// @ts-expect-error aliased node values retain their declared types
const invalidAppointments: ComputedRef<number[]> = result.nodes.appointments.data;
void invalidAppointments;
