import { GraphValidationError } from "./errors";
import { assertValidRefreshPolicy } from "../refresh-policies/policy";
import { assertValidReleasePolicy } from "../release-policies/policy";
import type { AnyEventDefinition } from "../events/types";
import type {
  ConditionalEventInvalidation,
  ContextNodeDefinition,
  ContextNodeOptions,
  DataNodeDefinition,
  DataNodeOptions,
  DependencyList,
  DependencySource,
  DerivedNodeDefinition,
  DerivedNodeOptions,
  EventInvalidationContext,
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

/**
 * Builds a conditional `invalidatedBy` entry: the node only invalidates for
 * publications of `event` where `when` returns `true`. Pass the exact
 * dependencies `when` needs to read as `dependencies` - this is what lets
 * `payload` and `get` be fully typed with no explicit annotation, and
 * lets `get` reject a node that isn't in that list, the same way it would
 * inside `load` or `derive`.
 *
 * `dependencies` here doesn't have to be the node's entire `dependencies`
 * list - just whichever of them (if any) `when` actually needs to read.
 *
 * @example
 * ```ts
 * import { defineContextNode, defineDataNode, defineEvent, whenEvent } from "vue-dependency-graph/core";
 *
 * const currentOrderId = defineContextNode({ key: "currentOrderId", initialValue: "" });
 * const orderStatusChanged = defineEvent<{ orderId: string; status: string }>(
 *   "order-status-changed",
 * );
 *
 * const order = defineDataNode({
 *   key: "order",
 *   dependencies: [currentOrderId],
 *   initialValue: null,
 *   invalidatedBy: [
 *     whenEvent(orderStatusChanged, [currentOrderId], ({ payload, get }) =>
 *       payload.orderId === get(currentOrderId),
 *     ),
 *   ],
 *   load: async ({ get }) => fetch(`/api/orders/${get(currentOrderId)}`).then((r) => r.json()),
 * });
 * ```
 *
 * @see {@link defineDataNode}'s `invalidatedBy` option.
 */
export const whenEvent = <
  TEvent extends AnyEventDefinition,
  const TDependencies extends DependencyList,
>(
  event: TEvent,
  dependencies: TDependencies,
  when: (context: EventInvalidationContext<TEvent, TDependencies>) => boolean,
): ConditionalEventInvalidation<TEvent, TDependencies> => Object.freeze({ event, when });

/**
 * Defines a **context node** — a graph root whose value is supplied by the
 * application, not fetched or computed. Context nodes hold things like the
 * signed-in user, the currently selected product, or the active currency:
 * state that originates outside the graph and that other nodes read as a
 * dependency.
 *
 * A context node has no `dependencies` and no loader. Its value starts at
 * `initialValue` and only changes when {@link GraphRuntime.setContext} is
 * called. Any data or derived node that needs the value should list the
 * context node as a dependency, so the graph knows to refetch or recompute
 * when it changes.
 *
 * @throws {@link GraphValidationError} (`INVALID_NODE_KEY`) if `key` is
 * empty or only whitespace.
 *
 * @example
 * ```ts
 * import { defineContextNode } from "vue-dependency-graph/core";
 *
 * // The product currently being viewed. Every node that depends on it -
 * // directly or transitively - refetches or recomputes when it changes.
 * const currentProductId = defineContextNode({
 *   key: "currentProductId",
 *   initialValue: "prod-1",
 * });
 *
 * // Elsewhere, once a runtime exists:
 * // runtime.setContext(currentProductId, "prod-42");
 * ```
 *
 * @see {@link defineDataNode} for nodes that fetch data derived from a context.
 * @see {@link GraphRuntime.setContext} for how a context node's value changes.
 */
export const defineContextNode = <TValue, const TKey extends string = string>(
  options: ContextNodeOptions<TValue, TKey>,
): ContextNodeDefinition<TValue, TKey> => {
  validateKey(options.key);

  return Object.freeze({
    key: options.key,
    kind: "context" as const,
    dependencies: Object.freeze([]) as readonly [],
    diagnostics: freezeDiagnostics(options.diagnostics),
    initialValue: options.initialValue,
  });
};

/**
 * Defines a **data node** — a graph node whose value is fetched
 * asynchronously via `load`, typically from an API. Data nodes are the
 * graph's connection to the outside world: product details, cart contents,
 * an order's status.
 *
 * `load` receives `get`, used to read the current value of any declared
 * `dependencies`, and `signal`, an `AbortSignal` that aborts if the node is
 * invalidated or released before the load settles - pass it through to
 * `fetch` so an abandoned request doesn't race a newer one. The node starts
 * at `initialValue` before the first load resolves.
 *
 * Use `refresh` ({@link staleAfter}, {@link refreshInterval},
 * {@link pollUntil}) to control when the value is refetched, `release`
 * ({@link retain}, {@link releaseAfter}) to control when it's freed once
 * unused, and `invalidatedBy` to refetch in response to a
 * {@link defineEvent}-declared event (e.g. a websocket push) rather than a
 * timer.
 *
 * @throws {@link GraphValidationError} (`INVALID_NODE_KEY`) if `key` is
 * empty or only whitespace. Dependency and event-invalidation declarations
 * are validated later, when the node is passed to {@link createGraph}.
 *
 * @example
 * ```ts
 * import { defineContextNode, defineDataNode } from "vue-dependency-graph/core";
 *
 * interface Product {
 *   readonly id: string;
 *   readonly name: string;
 *   readonly priceCents: number;
 * }
 *
 * const currentProductId = defineContextNode({
 *   key: "currentProductId",
 *   initialValue: "prod-1",
 * });
 *
 * const product = defineDataNode({
 *   key: "product",
 *   dependencies: [currentProductId],
 *   initialValue: null as Product | null,
 *   load: async ({ get, signal }) => {
 *     const response = await fetch(`/api/products/${get(currentProductId)}`, { signal });
 *     return (await response.json()) as Product;
 *   },
 * });
 * ```
 *
 * @see {@link defineDerivedNode} for values computed synchronously from
 * other nodes, without a fetch.
 * @see {@link defineEvent} for refetching in response to an external event
 * instead of - or alongside - a `refresh` policy.
 */
export const defineDataNode = <
  TValue,
  const TKey extends string = string,
  const TDependencies extends DependencyList = readonly [],
  const TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
>(
  options: DataNodeOptions<TValue, TDependencies, TInvalidatedBy, TKey>,
): DataNodeDefinition<TValue, TDependencies, TInvalidatedBy, TKey> => {
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

/**
 * Defines a **derived node** — a value computed synchronously from other
 * nodes via `derive`, with no fetch of its own. Use it for anything you'd
 * otherwise recompute by hand from data you already have: a formatted
 * price, a cart total, whether checkout is currently allowed.
 *
 * `derive` receives `get`, used to read the current value of any declared
 * `dependencies`, and runs again whenever one of them changes. Because it's
 * synchronous, a derived node never shows a loading state of its own - it's
 * only ever as fresh as its slowest dependency.
 *
 * Unlike {@link defineDataNode}, `dependencies` is required: a derived node
 * with nothing to derive from can't produce a value.
 *
 * @throws {@link GraphValidationError} (`INVALID_NODE_KEY`) if `key` is
 * empty or only whitespace. Dependency and event-invalidation declarations
 * are validated later, when the node is passed to {@link createGraph}.
 *
 * @example
 * ```ts
 * import { defineDataNode, defineDerivedNode } from "vue-dependency-graph/core";
 *
 * interface Product {
 *   readonly id: string;
 *   readonly name: string;
 *   readonly priceCents: number;
 * }
 *
 * declare const product: ReturnType<typeof defineDataNode<Product | null>>;
 *
 * // Pure formatting - recomputes instantly, no network involved.
 * const displayPrice = defineDerivedNode({
 *   key: "displayPrice",
 *   dependencies: [product],
 *   derive: ({ get }) => {
 *     const value = get(product);
 *     return value ? `$${(value.priceCents / 100).toFixed(2)}` : "—";
 *   },
 * });
 * ```
 *
 * @see {@link defineDataNode} for nodes that fetch their value.
 */
export const defineDerivedNode = <
  TValue,
  const TDependencies extends DependencyList,
  const TKey extends string = string,
  const TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
>(
  options: DerivedNodeOptions<TValue, TDependencies, TInvalidatedBy, TKey>,
): DerivedNodeDefinition<TValue, TDependencies, TInvalidatedBy, TKey> => {
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
