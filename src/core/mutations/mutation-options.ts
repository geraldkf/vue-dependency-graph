import type { MutationDefaults, MutationOptions } from "./types";

/**
 * Resolves the options a single `mutate` call runs with: the mutation's
 * definition-level defaults, with any field the call supplies replacing the
 * default for that field. Fields are replaced whole - an `onSuccess` at the
 * call site does not run alongside the default `onSuccess`. A field that is
 * `undefined` at the call site counts as not supplied.
 */
export const resolveMutationOptions = <TInput, TResult>(
  defaults: MutationDefaults | undefined,
  callOptions: MutationOptions<TInput, TResult> | undefined,
): MutationOptions<TInput, TResult> | undefined => {
  if (!defaults) return callOptions;
  // `defineMutation` type-checked these against this mutation's input and
  // result types; the stored form is erased (see MutationDefaults).
  const typedDefaults = defaults as MutationOptions<TInput, TResult>;
  if (!callOptions) return typedDefaults;

  const optimistic = callOptions.optimistic ?? typedDefaults.optimistic;
  const onSuccess = callOptions.onSuccess ?? typedDefaults.onSuccess;
  const classifyFailure = callOptions.classifyFailure ?? typedDefaults.classifyFailure;
  return {
    ...(optimistic && { optimistic }),
    ...(onSuccess && { onSuccess }),
    ...(classifyFailure && { classifyFailure }),
  };
};
