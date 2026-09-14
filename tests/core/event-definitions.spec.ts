import { describe, expect, it, vi } from "vitest";
import {
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
} from "../../src/core";

describe("event definitions", () => {
  it("defines an immutable typed event handle", () => {
    const event = defineEvent<{ jobSeekerId: number }>(
      "appointment.booked"
    );

    expect(event).toEqual({ key: "appointment.booked" });
    expect(Object.isFrozen(event)).toBe(true);
  });

  it.each(["", "   ", "\t\n"])("rejects blank event key %j", key => {
    expect(() => defineEvent<unknown>(key)).toThrowError(
      "Event key must not be blank."
    );
  });

  it("retains immutable event invalidation declarations without evaluating predicates", () => {
    const jobSeekerId = defineContextNode({
      key: "jobSeekerId",
      initialValue: 123,
    });
    const appointmentBooked = defineEvent<{ jobSeekerId: number }>(
      "appointment.booked"
    );
    const when = vi.fn(() => true);

    const data = defineDataNode({
      key: "capabilityStatus",
      dependencies: [jobSeekerId] as const,
      invalidatedBy: [
        appointmentBooked,
        { event: appointmentBooked, when },
      ] as const,
      initialValue: "unknown",
      load: async () => "current",
    });
    const derived = defineDerivedNode({
      key: "summary",
      dependencies: [data] as const,
      invalidatedBy: [appointmentBooked] as const,
      derive: () => "summary",
    });

    expect(data.invalidatedBy).toEqual([
      appointmentBooked,
      { event: appointmentBooked, when },
    ]);
    expect(derived.invalidatedBy).toEqual([appointmentBooked]);
    expect(Object.isFrozen(data.invalidatedBy)).toBe(true);
    expect(Object.isFrozen(derived.invalidatedBy)).toBe(true);
    expect(when).not.toHaveBeenCalled();
  });

  it("uses an immutable empty invalidation list when none is declared", () => {
    const data = defineDataNode({
      key: "data",
      initialValue: 0,
      load: async () => 1,
    });

    expect(data.invalidatedBy).toEqual([]);
    expect(Object.isFrozen(data.invalidatedBy)).toBe(true);
  });
});
