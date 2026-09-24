import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { RefreshPolicy } from "../refresh-policies/types";
import type { ReleasePolicy } from "../release-policies/types";

/**
 * Which of the three node factories produced a definition: `"context"`
 * ({@link defineContextNode}), `"data"` ({@link defineDataNode}), or
 * `"derived"` ({@link defineDerivedNode}).
 */
export type NodeKind = "context" | "data" | "derived";

type NodeDiagnosticRedactor<TValue> = {
  bivarianceHack(value: TValue): unknown;
}["bivarianceHack"];

export type NodeDiagnosticValueOptions<TValue> =
  "omit" | "include" | NodeDiagnosticRedactor<TValue>;

export interface NodeDiagnosticsOptions<TValue> {
  readonly value?: NodeDiagnosticValueOptions<TValue>;
}

/**
 * The shape common to every node definition, regardless of kind. Returned
 * by {@link defineContextNode}, {@link defineDataNode}, and
 * {@link defineDerivedNode} - you won't normally construct this directly,
 * but it's the type behind `AnyNodeDefinition` parameters you see across
 * the runtime API (e.g. {@link GraphRuntime.execute}).
 */
export interface NodeDefinition<
  TValue,
  TKind extends NodeKind = NodeKind,
  TDependencies extends readonly AnyNodeDefinition[] = readonly AnyNodeDefinition[],
  TKey extends string = string,
> {
  readonly key: TKey;
  readonly kind: TKind;
  readonly dependencies: TDependencies;
  readonly diagnostics?: NodeDiagnosticsOptions<TValue>;
  /** Carries TValue for type inference without storing runtime state. */
  readonly __valueType?: TValue;
}

/**
 * A node definition of any kind and value type - the type used for
 * parameters (`nodes: AnyNodeDefinition[]`) and collections that mix
 * context, data, and derived nodes together, e.g.
 * {@link CreateGraphOptions.nodes}.
 */
export type AnyNodeDefinition = NodeDefinition<unknown, NodeKind, readonly AnyNodeDefinition[]>;

/**
 * Extracts a node's value type from its definition. Useful when you need
 * to name a node's value type explicitly - a component prop, a derived
 * node's return type - rather than let it be inferred.
 *
 * @example
 * ```ts
 * import { defineDataNode, type NodeValue } from "vue-dependency-graph/core";
 *
 * interface Product {
 *   readonly id: string;
 *   readonly name: string;
 * }
 *
 * declare const product: ReturnType<typeof defineDataNode<Product | null>>;
 *
 * type ProductValue = NodeValue<typeof product>; // Product | null
 * ```
 */
export type NodeValue<TNode extends AnyNodeDefinition> =
  TNode extends NodeDefinition<infer TValue, NodeKind, readonly AnyNodeDefinition[]>
    ? TValue
    : never;

/** A node's `dependencies` list: zero or more other node definitions. */
export type DependencyList = readonly AnyNodeDefinition[];

/**
 * How `dependencies` may be declared: a plain array, or a function
 * returning one. Use a function to reference a node defined later in the
 * same module (a forward reference) - it's called once, on first use.
 */
export type DependencySource<TDependencies extends DependencyList> =
  TDependencies | (() => TDependencies);

/**
 * The `get` function passed to `load` ({@link LoadContext}) and `derive`
 * ({@link DeriveContext}). Reads a declared dependency's current value -
 * only nodes actually listed in `dependencies` are accepted, so `get`
 * accidentally reading an undeclared node is a compile error, not a
 * runtime surprise.
 */
export type GetDependencyValue<TDependencies extends DependencyList> = <
  TNode extends TDependencies[number],
>(
  node: TNode,
) => NodeValue<TNode>;

/** The argument passed to a {@link defineDataNode} `load` function. */
export interface LoadContext<TDependencies extends DependencyList> {
  /** Reads a declared dependency's current value. */
  readonly get: GetDependencyValue<TDependencies>;
  /**
   * Aborts if this load becomes stale (the node is invalidated, released,
   * or the runtime disposes) before it settles. Pass it to `fetch` so an
   * abandoned request doesn't race a newer one:
   * `fetch(url, { signal })`.
   */
  readonly signal: AbortSignal;
}

/** The argument passed to a {@link defineDerivedNode} `derive` function. */
export interface DeriveContext<TDependencies extends DependencyList> {
  /** Reads a declared dependency's current value. */
  readonly get: GetDependencyValue<TDependencies>;
}

/** The definition returned by {@link defineContextNode}. */
export interface ContextNodeDefinition<TValue, TKey extends string = string> extends NodeDefinition<
  TValue,
  "context",
  readonly [],
  TKey
> {
  readonly initialValue: TValue;
}

/** The argument passed to a conditional `invalidatedBy` entry's `when`. */
export interface EventInvalidationContext<
  TEvent extends AnyEventDefinition,
  TDependencies extends DependencyList,
> {
  /** The payload the event was published with. */
  readonly payload: EventPayload<TEvent>;
  /** Reads a declared dependency's current value. */
  readonly get: GetDependencyValue<TDependencies>;
}

/**
 * A conditional entry in `invalidatedBy`, produced by {@link whenEvent}: the
 * node only invalidates for publications of `event` where `when` returns
 * `true`. Compare a value on `payload` against a dependency read via `get`
 * to invalidate only the one matching instance - e.g. only the order whose
 * id matches this node's own. You won't normally construct this directly -
 * use {@link whenEvent}, which infers `payload` and `get`'s types for you.
 */
export interface ConditionalEventInvalidation<
  TEvent extends AnyEventDefinition,
  TDependencies extends DependencyList,
> {
  readonly event: TEvent;
  readonly when: (context: EventInvalidationContext<TEvent, TDependencies>) => boolean;
}

/** One entry in `invalidatedBy`: an event, or a {@link ConditionalEventInvalidation}. */
export type EventInvalidationDeclaration<
  TEvent extends AnyEventDefinition,
  TDependencies extends DependencyList,
> = TEvent | ConditionalEventInvalidation<TEvent, TDependencies>;

/** The type of a node's `invalidatedBy` option. */
export type EventInvalidationList<TDependencies extends DependencyList> =
  readonly EventInvalidationDeclaration<AnyEventDefinition, TDependencies>[];

/** The definition returned by {@link defineDataNode}. */
export interface DataNodeDefinition<
  TValue,
  TDependencies extends DependencyList,
  TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
  TKey extends string = string,
> extends NodeDefinition<TValue, "data", TDependencies, TKey> {
  readonly initialValue: TValue;
  readonly invalidatedBy: TInvalidatedBy;
  readonly refresh: RefreshPolicy<TValue> | undefined;
  readonly release: ReleasePolicy | undefined;
  readonly load: (context: LoadContext<TDependencies>) => Promise<TValue>;
}

/** The definition returned by {@link defineDerivedNode}. */
export interface DerivedNodeDefinition<
  TValue,
  TDependencies extends DependencyList,
  TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
  TKey extends string = string,
> extends NodeDefinition<TValue, "derived", TDependencies, TKey> {
  readonly invalidatedBy: TInvalidatedBy;
  readonly derive: (context: DeriveContext<TDependencies>) => TValue;
}

/** Options for {@link defineContextNode}. */
export interface ContextNodeOptions<TValue, TKey extends string = string> {
  /**
   * Unique identifier for this node within a graph. Used in diagnostics,
   * error messages, and to look the node up by key
   * ({@link Graph.getNode}).
   */
  readonly key: TKey;
  /** The node's value before {@link GraphRuntime.setContext} is ever called. */
  readonly initialValue: TValue;
  /** Controls whether this node's value is captured in diagnostic events. */
  readonly diagnostics?: NodeDiagnosticsOptions<TValue>;
}

/** Options for {@link defineDataNode}. */
export interface DataNodeOptions<
  TValue,
  TDependencies extends DependencyList = readonly [],
  TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
  TKey extends string = string,
> {
  /**
   * Unique identifier for this node within a graph. Used in diagnostics,
   * error messages, and to look the node up by key
   * ({@link Graph.getNode}). Each node's key has its own literal type,
   * which is what lets `get` reject a node that isn't a declared
   * dependency even when another node has an identical value type.
   */
  readonly key: TKey;
  /**
   * The nodes this node reads via `load`'s `get`. Either a plain array, or
   * a function returning one - use a function to declare a forward
   * reference to a node defined later in the same module.
   */
  readonly dependencies?: DependencySource<TDependencies>;
  /**
   * Events ({@link defineEvent}) that refetch this node when published,
   * instead of - or alongside - a `refresh` policy. Each entry is either
   * an event definition (invalidate on every publication), or a
   * {@link whenEvent} entry to invalidate only for payloads matching a
   * predicate (e.g. an order-status event, invalidated only when the
   * payload's `orderId` matches this node's own).
   */
  readonly invalidatedBy?: TInvalidatedBy;
  /**
   * Governs when a fresh value is refetched: {@link staleAfter} (refetch
   * on next read once stale), {@link refreshInterval} (refetch on a
   * timer), or {@link pollUntil} (refetch until a condition holds).
   * Omitted, the node only (re)loads when explicitly asked to via
   * {@link GraphRuntime.execute}/{@link GraphRuntime.refresh} or an
   * `invalidatedBy` event.
   */
  readonly refresh?: RefreshPolicy<TValue>;
  /**
   * Governs when this node's value is freed once it has no subscribers:
   * {@link retain} (never), {@link releaseAfter} (after an idle delay).
   * Omitted, the runtime's own `releaseAfterMs` default applies, if set.
   */
  readonly release?: ReleasePolicy;
  /** The node's value before the first `load` call resolves. */
  readonly initialValue: TValue;
  /** Controls whether this node's value is captured in diagnostic events. */
  readonly diagnostics?: NodeDiagnosticsOptions<TValue>;
  /**
   * Fetches the node's value. `get` reads a declared dependency's current
   * value; `signal` aborts if this load becomes stale before it settles -
   * pass it to `fetch` so an abandoned request doesn't race a newer one.
   */
  readonly load: (context: LoadContext<TDependencies>) => Promise<TValue>;
}

/** Options for {@link defineDerivedNode}. */
export interface DerivedNodeOptions<
  TValue,
  TDependencies extends DependencyList,
  TInvalidatedBy extends EventInvalidationList<TDependencies> = readonly [],
  TKey extends string = string,
> {
  /**
   * Unique identifier for this node within a graph. Used in diagnostics,
   * error messages, and to look the node up by key
   * ({@link Graph.getNode}). Each node's key has its own literal type,
   * which is what lets `get` reject a node that isn't a declared
   * dependency even when another node has an identical value type.
   */
  readonly key: TKey;
  /**
   * The nodes this node reads via `derive`'s `get`. Either a plain array,
   * or a function returning one - use a function to declare a forward
   * reference to a node defined later in the same module. Required: a
   * derived node with nothing to derive from can't produce a value.
   */
  readonly dependencies: DependencySource<TDependencies>;
  /**
   * Events ({@link defineEvent}) that recompute this node when published,
   * in addition to recomputing whenever a dependency changes. Each entry
   * is either an event definition (recompute on every publication), or a
   * {@link whenEvent} entry to recompute only for payloads matching a
   * predicate.
   */
  readonly invalidatedBy?: TInvalidatedBy;
  /** Controls whether this node's value is captured in diagnostic events. */
  readonly diagnostics?: NodeDiagnosticsOptions<TValue>;
  /**
   * Computes the node's value from its dependencies. `get` reads a
   * declared dependency's current value. Runs synchronously - no
   * `await`, no loading state - every time a dependency changes.
   */
  readonly derive: (context: DeriveContext<TDependencies>) => TValue;
}

/** A node definition, or its `key` string - accepted wherever a lookup is looser than an exact reference. */
export type NodeOrKey = AnyNodeDefinition | string;

/**
 * The frozen, validated graph produced by {@link createGraph} - the object
 * you pass to {@link createGraphRuntime}. Beyond that, it's a read-only
 * lookup and topology API, mainly useful for tooling and introspection
 * (the devtools panel is built on it) rather than everyday application code.
 */
export interface Graph {
  /** Looks up a node by key, or `undefined` if no node was registered under it. */
  readonly getNode: (key: string) => AnyNodeDefinition | undefined;
  /** Whether a node with this key was registered. */
  readonly hasNode: (key: string) => boolean;
  /** The nodes this node directly depends on. */
  readonly getParents: (nodeOrKey: NodeOrKey) => readonly AnyNodeDefinition[];
  /** The nodes that directly depend on this node. */
  readonly getChildren: (nodeOrKey: NodeOrKey) => readonly AnyNodeDefinition[];
  /** Every node registered in the graph, in no particular order. */
  readonly getNodes: () => readonly AnyNodeDefinition[];
}
