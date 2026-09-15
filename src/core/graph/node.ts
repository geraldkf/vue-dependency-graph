import { GraphValidationError } from "./errors";
import { assertValidRefreshPolicy } from "../refresh-policies/policy";
import type {
  ContextNodeDefinition,
  ContextNodeOptions,
  DataNodeDefinition,
  DataNodeOptions,
  DependencyList,
  DependencySource,
  DerivedNodeDefinition,
  DerivedNodeOptions,
  EventInvalidationList,
} from "./types";

const validateKey = (key: string): void => {
  if (key.trim().length === 0) {
    throw new GraphValidationError(
      "INVALID_NODE_KEY",
      "Node key must contain at least one non-whitespace character."
    );
  }
};

const resolveDependencies = <TDependencies extends DependencyList>(
  source: DependencySource<TDependencies> | undefined
): TDependencies => {
  const dependencies = typeof source === "function" ? source() : source;
  return (dependencies ?? []) as unknown as TDependencies;
};


const freezeDiagnostics = <TValue>(
  diagnostics: import("./types").NodeDiagnosticsOptions<TValue> | undefined,
): import("./types").NodeDiagnosticsOptions<TValue> =>
  Object.freeze({ value: diagnostics?.value ?? "omit" });

const freezeInvalidatedBy = <TInvalidatedBy extends readonly unknown[]>(
  invalidatedBy: TInvalidatedBy | undefined
): TInvalidatedBy =>
  Object.freeze([...(invalidatedBy ?? [])]) as unknown as TInvalidatedBy;

export const defineContextNode = <TValue>(
  options: ContextNodeOptions<TValue>
): ContextNodeDefinition<TValue> => {
  validateKey(options.key);

  return Object.freeze({
    key: options.key,
    kind: "context" as const,
    dependencies: Object.freeze([]) as readonly [],
    diagnostics: freezeDiagnostics(options.diagnostics),
    initialValue: options.initialValue,
  });
};

export const defineDataNode = <
  TValue,
  const TDependencies extends DependencyList = readonly [],
  const TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
>(
  options: DataNodeOptions<TValue, TDependencies, TInvalidatedBy>
): DataNodeDefinition<TValue, TDependencies, TInvalidatedBy> => {
  validateKey(options.key);

  const invalidatedBy = freezeInvalidatedBy(options.invalidatedBy);
  if (options.refresh !== undefined) {
    assertValidRefreshPolicy(options.refresh, options.key);
  }
  const definition = {
    key: options.key,
    kind: "data" as const,
    get dependencies(): TDependencies {
      return Object.freeze([...resolveDependencies(options.dependencies)]) as unknown as TDependencies;
    },
    invalidatedBy,
    diagnostics: freezeDiagnostics(options.diagnostics),
    refresh: options.refresh,
    initialValue: options.initialValue,
    load: options.load,
  };

  return Object.freeze(definition);
};

export const defineDerivedNode = <
  TValue,
  const TDependencies extends DependencyList,
  const TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
>(
  options: DerivedNodeOptions<TValue, TDependencies, TInvalidatedBy>
): DerivedNodeDefinition<TValue, TDependencies, TInvalidatedBy> => {
  validateKey(options.key);

  const invalidatedBy = freezeInvalidatedBy(options.invalidatedBy);
  const definition = {
    key: options.key,
    kind: "derived" as const,
    get dependencies(): TDependencies {
      return Object.freeze([...resolveDependencies(options.dependencies)]) as unknown as TDependencies;
    },
    invalidatedBy,
    diagnostics: freezeDiagnostics(options.diagnostics),
    derive: options.derive,
  };

  return Object.freeze(definition);
};
