import type { DefineMutationOptions, MutationDefinition } from "./types";

export const defineMutation = <TInput, TResult>(
  options: DefineMutationOptions<TInput, TResult>,
): MutationDefinition<TInput, TResult> => {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.key !== "string" ||
    options.key.trim().length === 0
  ) {
    throw new Error("Mutation key must not be blank.");
  }

  if (typeof options.execute !== "function") {
    throw new Error("Mutation execute must be a function.");
  }

  return Object.freeze({
    key: options.key,
    execute: options.execute,
  });
};
