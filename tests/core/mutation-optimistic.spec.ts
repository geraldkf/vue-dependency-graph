import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineDerivedNode,
  defineMutation,
  GraphMutationConflictError,
  GraphMutationOutcomeUnknownError,
  GraphMutationStateError,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

interface Appointment {
  readonly id: number;
  readonly status: "pending" | "confirmed";
}

const createAppointments = () =>
  defineDataNode({
    key: "optimistic-appointments",
    initialValue: [] as Appointment[],
    load: async () => [{ id: 1, status: "confirmed" }],
  });

describe("optimistic mutations", () => {
  it("applies a multi-node optimistic draft atomically before remote settlement", async () => {
    const appointments = createAppointments();
    const count = defineDataNode({
      key: "optimistic-count",
      initialValue: 0,
      load: async () => 1,
    });
    const request = deferred<{ readonly id: number }>();
    const mutation = defineMutation({
      key: "appointment.book",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [appointments, count] }));
    await runtime.execute([appointments, count]);
    const snapshots: string[] = [];
    runtime.onChange(() => {
      snapshots.push(
        `${runtime.getState(appointments).data.length}:${runtime.getState(count).data}`,
      );
    });

    const result = runtime.mutate(mutation, undefined, {
      optimistic: effects => {
        effects.update(appointments, current => [
          ...current,
          { id: -1, status: "pending" },
        ]);
        effects.update(count, current => current + 1);
      },
    });

    await waitForCondition(
      () => runtime.getState(appointments).data.length === 2,
      "optimistic values to become visible",
    );

    expect(runtime.getState(appointments)).toMatchObject({
      data: [
        { id: 1, status: "confirmed" },
        { id: -1, status: "pending" },
      ],
      status: "success",
      freshness: "fresh",
      generation: 1,
    });
    expect(runtime.getState(count)).toMatchObject({ data: 2, generation: 1 });
    expect(snapshots).toEqual(["2:2"]);

    request.resolve({ id: 2 });
    await expect(result).resolves.toEqual({ id: 2 });
  });

  it("restores exact target and descendant snapshots after a known rejection", async () => {
    const appointments = createAppointments();
    const summary = defineDerivedNode({
      key: "optimistic-summary",
      dependencies: [appointments] as const,
      derive: ({ get }) => get(appointments).length,
    });
    const failure = new Error("Booking rejected");
    const request = deferred<never>();
    const mutation = defineMutation({
      key: "appointment.reject",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [summary, appointments] }));
    await runtime.execute([summary]);
    const beforeAppointments = runtime.getState(appointments);
    const beforeSummary = runtime.getState(summary);

    const result = runtime.mutate(mutation, undefined, {
      optimistic: effects => {
        effects.update(appointments, current => [
          ...current,
          { id: -1, status: "pending" },
        ]);
      },
      classifyFailure: () => "rejected",
    });

    await waitForCondition(
      () => runtime.getState(appointments).data.length === 2,
      "optimistic appointment to appear",
    );
    expect(runtime.getState(summary)).toMatchObject({
      data: 1,
      freshness: "stale",
      generation: 1,
    });

    request.reject(failure);
    await expect(result).rejects.toBe(failure);

    expect(runtime.getState(appointments)).toEqual(beforeAppointments);
    expect(runtime.getState(summary)).toEqual(beforeSummary);
  });

  it("reconciles success without a transient rollback", async () => {
    const appointments = createAppointments();
    const request = deferred<{ readonly id: number }>();
    const mutation = defineMutation({
      key: "appointment.confirm",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [appointments] }));
    await runtime.execute([appointments]);
    const observedIds: number[][] = [];
    runtime.onChange(() => {
      observedIds.push(runtime.getState(appointments).data.map(item => item.id));
    });

    const result = runtime.mutate(mutation, undefined, {
      optimistic: effects => {
        effects.update(appointments, current => [
          ...current,
          { id: -1, status: "pending" },
        ]);
      },
      onSuccess: (effects, response) => {
        effects.update(appointments, current =>
          current.map(item =>
            item.id === -1
              ? { id: response.id, status: "confirmed" }
              : item,
          ),
        );
      },
      classifyFailure: () => "rejected",
    });

    await waitForCondition(
      () => runtime.getState(appointments).data.some(item => item.id === -1),
      "pending appointment to appear",
    );
    request.resolve({ id: 2 });
    await result;

    expect(runtime.getState(appointments).data).toEqual([
      { id: 1, status: "confirmed" },
      { id: 2, status: "confirmed" },
    ]);
    expect(observedIds).toEqual([[1, -1], [1, 2]]);
    expect(observedIds).not.toContainEqual([1]);
  });

  it("rejects a same-node optimistic conflict before starting the second request", async () => {
    const appointments = createAppointments();
    const firstRequest = deferred<void>();
    const firstExecute = vi.fn(async () => firstRequest.promise);
    const secondExecute = vi.fn(async () => undefined);
    const firstMutation = defineMutation({ key: "appointment.first", execute: firstExecute });
    const secondMutation = defineMutation({ key: "appointment.second", execute: secondExecute });
    const runtime = createGraphRuntime(createGraph({ nodes: [appointments] }));
    await runtime.execute([appointments]);

    const first = runtime.mutate(firstMutation, undefined, {
      optimistic: effects => effects.update(appointments, current => [
        ...current,
        { id: -1, status: "pending" },
      ]),
    });
    await waitForCondition(
      () => runtime.getState(appointments).data.length === 2,
      "first optimistic mutation to own appointments",
    );

    await expect(runtime.mutate(secondMutation, undefined, {
      optimistic: effects => effects.update(appointments, current => [
        ...current,
        { id: -2, status: "pending" },
      ]),
    })).rejects.toBeInstanceOf(GraphMutationConflictError);

    expect(secondExecute).not.toHaveBeenCalled();
    firstRequest.resolve();
    await first;
  });

  it("rejects a never-successful optimistic target before starting the request", async () => {
    const appointments = createAppointments();
    const execute = vi.fn(async () => undefined);
    const mutation = defineMutation({ key: "appointment.unloaded", execute });
    const runtime = createGraphRuntime(createGraph({ nodes: [appointments] }));

    await expect(runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(appointments, () => []),
    })).rejects.toBeInstanceOf(GraphMutationStateError);

    expect(execute).not.toHaveBeenCalled();
    expect(runtime.getState(appointments)).toMatchObject({
      data: [],
      generation: 0,
      hasSuccessfulValue: false,
    });
  });

  it("reports an unclassified outcome and makes optimistic state stale", async () => {
    const appointments = createAppointments();
    const failure = new Error("Connection lost");
    const mutation = defineMutation({
      key: "appointment.unknown",
      execute: async () => {
        throw failure;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [appointments] }));
    await runtime.execute([appointments]);

    await expect(runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(appointments, current => [
        ...current,
        { id: -1, status: "pending" },
      ]),
    })).rejects.toMatchObject({
      name: "GraphMutationOutcomeUnknownError",
      cause: failure,
      nodeKeys: [appointments.key],
    });

    expect(runtime.getState(appointments)).toMatchObject({
      data: [
        { id: 1, status: "confirmed" },
        { id: -1, status: "pending" },
      ],
      freshness: "stale",
    });
  });
});
