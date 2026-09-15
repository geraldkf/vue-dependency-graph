import { describe, expect, it } from "vitest";
import {
  defineMutation,
  type DefineMutationOptions,
  type MutationExecuteContext,
} from "../../src/core";

interface SaveInput {
  readonly value: string;
}

interface SaveResult {
  readonly id: number;
  readonly value: string;
}

describe("mutation definitions", () => {
  it("creates an immutable typed remote command definition", () => {
    const execute = async ({ input }: MutationExecuteContext<SaveInput>) => ({
      id: 1,
      value: input.value,
    });

    const mutation = defineMutation({
      key: "value.save",
      execute,
    });

    expect(mutation).toEqual({ key: "value.save", execute });
    expect(Object.isFrozen(mutation)).toBe(true);
  });

  it("rejects a blank mutation key", () => {
    expect(() =>
      defineMutation({
        key: "   ",
        execute: async () => ({ id: 1, value: "value" }),
      }),
    ).toThrow("Mutation key must not be blank.");
  });

  it("rejects a malformed definition from untyped JavaScript", () => {
    const malformed = {
      key: "value.save",
      execute: undefined,
    } as unknown as DefineMutationOptions<SaveInput, SaveResult>;

    expect(() => defineMutation(malformed)).toThrow(
      "Mutation execute must be a function.",
    );
  });
});
