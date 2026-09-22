import { defineContextNode, defineDataNode, defineQuery, type QueryNodes } from "../../src/core";

const jobSeekerId = defineContextNode({
  key: "typed-query-job-seeker-id",
  initialValue: 101,
});

const appointments = defineDataNode({
  key: "typed-query-appointments",
  dependencies: [jobSeekerId] as const,
  initialValue: [] as string[],
  load: async () => ["appointment"],
});

const appointmentsPage = defineQuery({
  key: "typed-appointments-page",
  nodes: {
    currentJobSeeker: jobSeekerId,
    appointments,
  },
});

type AppointmentsPageNodes = QueryNodes<typeof appointmentsPage>;

const currentJobSeeker: AppointmentsPageNodes["currentJobSeeker"] = jobSeekerId;
const appointmentList: AppointmentsPageNodes["appointments"] = appointments;
void [currentJobSeeker, appointmentList];

// @ts-expect-error query aliases are retained exactly
const missingAlias: AppointmentsPageNodes["missing"] = appointments;
void missingAlias;

// @ts-expect-error query entries must be node definitions
defineQuery({ key: "invalid-query-node", nodes: { invalid: "node" } });
