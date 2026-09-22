import { GraphValidationError } from "./errors";
import { assertValidRefreshPolicy } from "../refresh-policies/policy";
import { assertValidReleasePolicy } from "../release-policies/policy";
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
      "Node key must contain at least one non-whitespace character.",
    );
  }
};

/**
 * Produces the accessor behind a node's `dependencies` property.
 *
 * - A plain array is copied and frozen immediately, so later mutation of the
 *   caller's array cannot change the node's topology.
 * - A resolver function is *not* called here (that would break forward
 *   references between definitions). It is called on first access - normally
 *   during `createGraph` - and its result is frozen and reused for every later
 *   access, so the resolver runs at most once per successful resolution and
 *   every consumer sees the same array. A resolver that throws is not cached:
 *   the failure propagates and the next access tries again.
 */
const createDependencyAccessor = <TDependencies extends DependencyList>(
  source: DependencySource<TDependencies> | undefined,
): (() => TDependencies) => {
  if (typeof source !== "function") {
    const dependencies = Object.freeze([...(source ?? [])]) as unknown as TDependencies;
    return () => dependencies;
  }

  let resolved: TDependencies | undefined;
  return () => {
    if (resolved === undefined) {
      resolved = Object.freeze([...source()]) as unknown as TDependencies;
    }
    return resolved;
  };
};

const freezeDiagnostics = <TValue>(
  diagnostics: import("./types").NodeDiagnosticsOptions<TValue> | undefined,
): import("./types").NodeDiagnosticsOptions<TValue> =>
  Object.freeze({ value: diagnostics?.value ?? "omit" });

const freezeInvalidatedBy = <TInvalidatedBy extends readonly unknown[]>(
  invalidatedBy: TInvalidatedBy | undefined,
): TInvalidatedBy => Object.freeze([...(invalidatedBy ?? [])]) as unknown as TInvalidatedBy;

export const defineContextNode = <TValue>(
  options: ContextNodeOptions<TValue>,
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
  options: DataNodeOptions<TValue, TDependencies, TInvalidatedBy>,
): DataNodeDefinition<TValue, TDependencies, TInvalidatedBy> => {
  validateKey(options.key);

  const invalidatedBy = freezeInvalidatedBy(options.invalidatedBy);
  const getDependencies = createDependencyAccessor(options.dependencies);
  if (options.refresh !== undefined) {
    assertValidRefreshPolicy(options.refresh, options.key);
  }
  if (options.release !== undefined) {
    assertValidReleasePolicy(options.release, options.key);
  }
  const definition = {
    key: options.key,
    kind: "data" as const,
    get dependencies(): TDependencies {
      return getDependencies();
    },
    invalidatedBy,
    diagnostics: freezeDiagnostics(options.diagnostics),
    refresh: options.refresh,
    release: options.release,
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
  options: DerivedNodeOptions<TValue, TDependencies, TInvalidatedBy>,
): DerivedNodeDefinition<TValue, TDependencies, TInvalidatedBy> => {
  validateKey(options.key);

  const invalidatedBy = freezeInvalidatedBy(options.invalidatedBy);
  const getDependencies = createDependencyAccessor(options.dependencies);
  const definition = {
    key: options.key,
    kind: "derived" as const,
    get dependencies(): TDependencies {
      return getDependencies();
    },
    invalidatedBy,
    diagnostics: freezeDiagnostics(options.diagnostics),
    derive: options.derive,
  };

  return Object.freeze(definition);
};
