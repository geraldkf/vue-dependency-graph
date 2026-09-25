import { describe, expect, it } from "vitest";
import {
  GraphMutationConflictError,
  GraphMutationError,
  GraphMutationOutcomeUnknownError,
  GraphMutationReconciliationError,
  GraphMutationRollbackConflictError,
  GraphMutationStateError,
  type GraphMutationErrorCode,
} from "../../src/core";

describe("GraphMutationError hierarchy", () => {
  const cases: readonly {
    readonly error: GraphMutationError;
    readonly expectedCode: GraphMutationErrorCode;
    readonly expectedName: string;
  }[] = [
    {
      error: new GraphMutationStateError("cart", "update() was called twice for this node."),
      expectedCode: "STATE",
      expectedName: "GraphMutationStateError",
    },
    {
      error: new GraphMutationConflictError(["cart"]),
      expectedCode: "CONFLICT",
      expectedName: "GraphMutationConflictError",
    },
    {
      error: new GraphMutationOutcomeUnknownError(["order"], new Error("network drop")),
      expectedCode: "OUTCOME_UNKNOWN",
      expectedName: "GraphMutationOutcomeUnknownError",
    },
    {
      error: new GraphMutationReconciliationError("cart.add", ["cart"], new Error("bad response")),
      expectedCode: "RECONCILIATION",
      expectedName: "GraphMutationReconciliationError",
    },
    {
      error: new GraphMutationRollbackConflictError(["cart"], new Error("sold out")),
      expectedCode: "ROLLBACK_CONFLICT",
      expectedName: "GraphMutationRollbackConflictError",
    },
  ];

  it.each(cases)(
    "$expectedName is an instance of the shared GraphMutationError base",
    ({ error, expectedCode, expectedName }) => {
      expect(error).toBeInstanceOf(GraphMutationError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(expectedCode);
      expect(error.name).toBe(expectedName);
    },
  );

  it("lets a broad catch branch on `code` without instanceof-chaining every subclass", () => {
    const errors: readonly GraphMutationError[] = cases.map((c) => c.error);
    const codesSeen = errors.map((error) => {
      if (error instanceof GraphMutationError) {
        return error.code;
      }
      throw new Error("expected a GraphMutationError");
    });

    expect(codesSeen).toEqual([
      "STATE",
      "CONFLICT",
      "OUTCOME_UNKNOWN",
      "RECONCILIATION",
      "ROLLBACK_CONFLICT",
    ]);
  });

  it("preserves cause for the errors that carry one", () => {
    const cause = new Error("network drop");
    const error = new GraphMutationOutcomeUnknownError(["order"], cause);

    expect(error.cause).toBe(cause);
  });

  it("GraphMutationReconciliationError always reports remoteSucceeded: true", () => {
    const error = new GraphMutationReconciliationError("cart.add", ["cart"], new Error("bad"));

    expect(error.remoteSucceeded).toBe(true);
  });
});
