import { GraphValidationError } from "./errors";
import type {
  ContextNodeDefinition,
  ContextNodeOptions,
  DataNodeDefinition,
  DataNodeOptions,
  DependencyList,
  DependencySource,
  DerivedNodeDefinition,
  DerivedNodeOptions,
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

export const defineContextNode = <TValue>(
  options: ContextNodeOptions<TValue>
): ContextNodeDefinition<TValue> => {
  validateKey(options.key);

  return Object.freeze({
    key: options.key,
    kind: "context" as const,
    dependencies: Object.freeze([]) as readonly [],
    initialValue: options.initialValue,
  });
};

export const defineDataNode = <
  TValue,
  const TDependencies extends DependencyList = readonly [],
>(
  options: DataNodeOptions<TValue, TDependencies>
): DataNodeDefinition<TValue, TDependencies> => {
  validateKey(options.key);

  const definition = {
    key: options.key,
    kind: "data" as const,
    get dependencies(): TDependencies {
      return Object.freeze([...resolveDependencies(options.dependencies)]) as unknown as TDependencies;
    },
    initialValue: options.initialValue,
    load: options.load,
  };

  return Object.freeze(definition);
};

export const defineDerivedNode = <
  TValue,
  const TDependencies extends DependencyList,
>(
  options: DerivedNodeOptions<TValue, TDependencies>
): DerivedNodeDefinition<TValue, TDependencies> => {
  validateKey(options.key);

  const definition = {
    key: options.key,
    kind: "derived" as const,
    get dependencies(): TDependencies {
      return Object.freeze([...resolveDependencies(options.dependencies)]) as unknown as TDependencies;
    },
    derive: options.derive,
  };

  return Object.freeze(definition);
};
