import { describe, expect, it } from "vitest";
import type { NodeStateRecord } from "../../src/core/state/state";
import {
  abortAttempt,
  beginAttempt,
  failAttempt,
  invalidate,
  releaseValue,
  restoreSnapshot,
  succeedAttempt,
  writeValue,
  type NodeStateFields,
} from "../../src/core/state/transitions";
import type { NodeRuntimeState } from "../../src/core";
import { stateInvariantViolations } from "./state-trace-helpers";

const make = (
  overrides: Partial<NodeStateRecord> = {},
): NodeStateRecord => ({
  data: "data",
  status: "success",
  freshness: "fresh",
  error: null,
  generation: 4,
  hasSuccessfulValue: true,
  ...overrides,
});

const failure = new Error("failure");

describe("state transitions", () => {
  describe("invalidate", () => {
    it("keeps the value, goes stale, and bumps the generation", () => {
      const state = make();
      invalidate(state);
      expect(state).toEqual(make({ freshness: "stale", generation: 5 }));
    });

    it("clears an error and returns to success when there is a value", () => {
      const state = make({ status: "error", freshness: "stale", error: failure });
      invalidate(state);
      expect(state).toEqual(make({ freshness: "stale", generation: 5 }));
    });

    it("goes idle when there is no value", () => {
      const state = make({
        data: 0,
        status: "loading",
        freshness: "stale",
        hasSuccessfulValue: false,
      });
      invalidate(state);
      expect(state).toEqual(
        make({
          data: 0,
          status: "idle",
          freshness: "stale",
          hasSuccessfulValue: false,
          generation: 5,
        }),
      );
    });
  });

  describe("beginAttempt", () => {
    it("refreshes when there is a value, keeping it and the generation", () => {
      const state = make({ status: "error", freshness: "stale", error: failure });
      beginAttempt(state);
      expect(state).toEqual(
        make({ status: "refreshing", freshness: "stale" }),
      );
    });

    it("loads when there is no value", () => {
      const state = make({
        data: 0,
        status: "idle",
        freshness: "stale",
        hasSuccessfulValue: false,
      });
      beginAttempt(state);
      expect(state).toEqual(
        make({
          data: 0,
          status: "loading",
          freshness: "stale",
          hasSuccessfulValue: false,
        }),
      );
    });
  });

  describe("succeedAttempt", () => {
    it("stores the value as fresh and successful without touching the generation", () => {
      const state = make({
        data: 0,
        status: "loading",
        freshness: "stale",
        hasSuccessfulValue: false,
      });
      succeedAttempt(state, "loaded");
      expect(state).toEqual(make({ data: "loaded" }));
    });
  });

  describe("abortAttempt", () => {
    it("keeps the value visible, goes stale, and keeps the generation when refreshing", () => {
      const state = make({ status: "refreshing", freshness: "stale" });
      abortAttempt(state);
      expect(state).toEqual(make({ status: "success", freshness: "stale" }));
    });

    it("returns a never-loaded node to idle", () => {
      const state = make({
        data: 0,
        status: "loading",
        freshness: "stale",
        hasSuccessfulValue: false,
      });
      abortAttempt(state);
      expect(state).toEqual(
        make({
          data: 0,
          status: "idle",
          freshness: "stale",
          hasSuccessfulValue: false,
        }),
      );
    });
  });

  describe("failAttempt", () => {
    it("records the error, keeps the value and its flag, and keeps the generation", () => {
      const state = make({ status: "refreshing", freshness: "stale" });
      failAttempt(state, failure);
      expect(state).toEqual(
        make({ status: "error", freshness: "stale", error: failure }),
      );
    });

    it("leaves a never-loaded node without a value", () => {
      const state = make({
        data: 0,
        status: "loading",
        freshness: "stale",
        hasSuccessfulValue: false,
      });
      failAttempt(state, failure);
      expect(state).toEqual(
        make({
          data: 0,
          status: "error",
          freshness: "stale",
          error: failure,
          hasSuccessfulValue: false,
        }),
      );
    });
  });

  describe("writeValue", () => {
    it.each(["fresh", "stale"] as const)(
      "writes a %s value, clears any error, and bumps the generation",
      freshness => {
        const state = make({ status: "error", freshness: "stale", error: failure });
        writeValue(state, "written", freshness);
        expect(state).toEqual(
          make({ data: "written", freshness, generation: 5 }),
        );
      },
    );
  });

  describe("restoreSnapshot", () => {
    it("restores every snapshot field but bumps the generation instead of rewinding it", () => {
      const snapshot: NodeStateFields = {
        data: "before",
        status: "error",
        freshness: "stale",
        error: failure,
        hasSuccessfulValue: true,
      };
      const state = make({ data: "optimistic", generation: 7 });
      restoreSnapshot(state, snapshot);
      expect(state).toEqual(make({ ...snapshot, generation: 8 }));
    });
  });

  describe("releaseValue", () => {
    it("returns to the never-loaded shape with the initial value and bumps the generation", () => {
      const state = make({ data: "loaded" });
      releaseValue(state, "initial");
      expect(state).toEqual(
        make({
          data: "initial",
          status: "idle",
          freshness: "stale",
          hasSuccessfulValue: false,
          generation: 5,
        }),
      );
    });
  });

  describe("generation rule", () => {
    it("bumps only on transitions that supersede in-flight work", () => {
      const generationDelta = (apply: (state: NodeStateRecord) => void) => {
        const state = make();
        apply(state);
        return state.generation - 4;
      };

      expect({
        invalidate: generationDelta(invalidate),
        writeValue: generationDelta(state => writeValue(state, 1, "fresh")),
        restoreSnapshot: generationDelta(state => restoreSnapshot(state, make())),
        releaseValue: generationDelta(state => releaseValue(state, 0)),
        beginAttempt: generationDelta(beginAttempt),
        succeedAttempt: generationDelta(state => succeedAttempt(state, 1)),
        failAttempt: generationDelta(state => failAttempt(state, failure)),
        abortAttempt: generationDelta(abortAttempt),
      }).toEqual({
        invalidate: 1,
        writeValue: 1,
        restoreSnapshot: 1,
        releaseValue: 1,
        beginAttempt: 0,
        succeedAttempt: 0,
        failAttempt: 0,
        abortAttempt: 0,
      });
    });
  });

  describe("invariants", () => {
    const statuses = ["idle", "loading", "refreshing", "success", "error"] as const;
    const freshnesses = ["fresh", "stale"] as const;
    const errors = [null, failure] as const;
    const flags = [false, true] as const;

    const allStates: NodeStateRecord[] = [];
    for (const status of statuses) {
      for (const freshness of freshnesses) {
        for (const error of errors) {
          for (const hasSuccessfulValue of flags) {
            allStates.push(
              make({ status, freshness, error, hasSuccessfulValue }),
            );
          }
        }
      }
    }
    const violations = (state: NodeStateRecord) =>
      stateInvariantViolations(state as unknown as NodeRuntimeState<unknown>);
    const validStates = allStates.filter(state => violations(state).length === 0);

    it("has a non-trivial set of valid states to start from", () => {
      expect(allStates).toHaveLength(40);
      expect(validStates.length).toBeGreaterThan(5);
      expect(validStates.length).toBeLessThan(allStates.length);
    });

    const transitions: readonly (readonly [
      string,
      (state: NodeStateRecord) => void,
    ])[] = [
      ["invalidate", invalidate],
      ["beginAttempt", beginAttempt],
      ["succeedAttempt", state => succeedAttempt(state, "value")],
      ["failAttempt", state => failAttempt(state, failure)],
      ["abortAttempt", abortAttempt],
      ["writeValue fresh", state => writeValue(state, "value", "fresh")],
      ["writeValue stale", state => writeValue(state, "value", "stale")],
      ["releaseValue", state => releaseValue(state, "initial")],
    ];

    it.each(transitions)(
      "%s leaves every valid state valid",
      (_name, transition) => {
        for (const start of validStates) {
          const state = { ...start };
          transition(state);
          expect(
            violations(state),
            `from ${start.status}/${start.freshness} value=${start.hasSuccessfulValue} error=${start.error !== null}`,
          ).toEqual([]);
        }
      },
    );

    it("restoreSnapshot leaves a state valid when the snapshot is valid", () => {
      for (const start of validStates) {
        for (const snapshot of validStates) {
          const state = { ...start };
          restoreSnapshot(state, snapshot);
          expect(violations(state)).toEqual([]);
        }
      }
    });
  });
});
