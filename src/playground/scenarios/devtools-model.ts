import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  refreshInterval,
  whenEvent,
  type GraphRuntime,
  type InMemoryGraphDiagnostics,
  type NodeSubscription,
} from "../../core";

export interface DevtoolsPlaygroundScenario {
  readonly runtime: GraphRuntime;
  readonly diagnostics: InMemoryGraphDiagnostics;
  readonly changeUser: () => void;
  readonly bookAppointment: () => Promise<void>;
  readonly failNextLoad: () => void;
  readonly dispose: () => void;
}

export const createDevtoolsPlaygroundScenario = (): DevtoolsPlaygroundScenario => {
  const diagnostics = createInMemoryGraphDiagnostics({ capacity: 300 });
  let nextUserSuffix = 2;
  let failNext = false;

  const AppointmentBooked = defineEvent<{ userId: string }>(
    "devtools-playground.appointment-booked",
  );

  const emptyAppointments: readonly string[] = [];

  const UserId = defineContextNode<string>({
    key: "devtools-playground.userId",
    initialValue: "user-1",
  });

  const Appointments = defineDataNode({
    key: "devtools-playground.appointments",
    dependencies: [UserId],
    initialValue: emptyAppointments,
    invalidatedBy: [
      whenEvent(AppointmentBooked, [UserId], ({ payload, get }) => payload.userId === get(UserId)),
    ],
    load: async ({ get }) => {
      if (failNext) {
        failNext = false;
        throw new Error("Demonstration load failure.");
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      return [`Checkup for ${get(UserId)}`, `Follow-up for ${get(UserId)}`];
    },
  });

  const AppointmentCount = defineDerivedNode({
    key: "devtools-playground.appointmentCount",
    dependencies: [Appointments] as const,
    derive: ({ get }) => get(Appointments).length,
  });

  const ComplianceStatus = defineDataNode({
    key: "devtools-playground.complianceStatus",
    dependencies: [UserId] as const,
    initialValue: "unknown",
    refresh: refreshInterval({ intervalMs: 5_000 }),
    load: async ({ get }) => `${get(UserId)} is compliant`,
  });

  const BookAppointment = defineMutation({
    key: "devtools-playground.book-appointment",
    execute: async ({ input }: { input: { userId: string } }) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { userId: input.userId, appointmentId: `apt-${Date.now()}` };
    },
  });

  const graph = createGraph({
    nodes: [UserId, Appointments, AppointmentCount, ComplianceStatus],
  });
  const runtime = createGraphRuntime(graph, { diagnostics: { sink: diagnostics } });

  let subscription: NodeSubscription | undefined = runtime.subscribeNodes([
    AppointmentCount,
    ComplianceStatus,
  ]);

  const changeUser = (): void => {
    runtime.setContext(UserId, `user-${nextUserSuffix}`);
    nextUserSuffix += 1;
  };

  const bookAppointment = async (): Promise<void> => {
    const userId = runtime.getState(UserId).data;
    await runtime.mutate(
      BookAppointment,
      { userId },
      {
        onSuccess: (effects, result) => {
          effects.publish(AppointmentBooked, { userId: result.userId });
        },
      },
    );
  };

  const failNextLoad = (): void => {
    failNext = true;
  };

  const dispose = (): void => {
    subscription?.unsubscribe();
    subscription = undefined;
  };

  return {
    runtime,
    diagnostics,
    changeUser,
    bookAppointment,
    failNextLoad,
    dispose,
  };
};
