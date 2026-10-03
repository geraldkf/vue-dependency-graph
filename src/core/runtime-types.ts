import type { NodeSubscription, NodeSubscriptionState } from "./subscriptions/types";
import type { SchedulerState } from "./scheduling/types";
import type { RuntimeListener } from "./observation/types";
import type { GraphTransaction } from "./transactions/types";
import type { NodeRuntimeState, RuntimeNodeData } from "./state/types";
import type { RefreshableNodeDefinition } from "./operations/types";
import type { AnyNodeDefinition, ContextNodeDefinition } from "./graph/types";
import type { AnyEventDefinition, EventPayload } from "./events/types";
import type { AnyQueryDefinition } from "./queries/types";
import type { TimerEnvironment } from "./timer-environment";
import type { MutationDefinition, MutationOptions } from "./mutations/types";
import type { GraphDiagnosticsOptions } from "./diagnostics/types";
import type { GraphDiagnosticSnapshotV1 } from "./diagnostics/snapshot";

/** Options for {@link createGraphRuntime}. */
export interface GraphRuntimeOptions {
  /**
   * Maximum number of data-node load functions that may run concurrently
   * within this runtime. Defaults to unlimited concurrency.
   */
  readonly maxConcurrentLoads?: number;
  /**
   * Clock and timer services used by refresh policies and release
   * policies. Tests may inject a deterministic environment. Defaults to
   * platform timers.
   */
  readonly timerEnvironment?: TimerEnvironment;
  /**
   * Default idle duration, in milliseconds, before a data node's value is
   * automatically released (reset to its never-loaded shape) once it has
   * no subscribers - direct or required. A node's own `release` option,
   * when declared, always takes precedence over this default, including
   * `Infinity`, which opts a node out even when this default is set.
   * Omitted entirely, no automatic release happens for any node unless it
   * declares its own `release` duration. See
   * `docs/decisions/ADR-016-value-release-policies.md`.
   */
  readonly releaseAfterMs?: number;
  /**
   * Optional structured runtime diagnostics. Diagnostics are observational,
   * synchronous, failure-isolated, and disabled when omitted.
   */
  readonly diagnostics?: GraphDiagnosticsOptions;
}

export interface GraphRuntime {
  /** Permanently rejects new work, aborts owned loads/mutations and pending transactions,
   * clears listeners and subscriptions, and prevents late value commits. Idempotent.
   * Reads and diagnostic snapshots remain available. Remote side effects cannot be undone.
   */
  readonly shutdown: () => void;
  /** Stops policy timers without ending the runtime. Alias of the legacy dispose(). */
  readonly stopBackgroundPolicies: () => void;
  /**
   * Reads a node's current runtime state: `data` (its value, wrapped per
   * node kind), `status` (e.g. `"idle"`, `"loading"`, `"success"`,
   * `"error"`), `error`, and more. This is a synchronous snapshot - it
   * does not trigger a load. Most application code reads values through
   * the Vue composables ({@link useNode}) rather than calling this
   * directly.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineContextNode } from "vue-dependency-graph/core";
   *
   * const currentProductId = defineContextNode({ key: "currentProductId", initialValue: "prod-1" });
   * const runtime = createGraphRuntime(createGraph({ nodes: [currentProductId] }));
   *
   * const state = runtime.getState(currentProductId);
   * console.log(state.data); // "prod-1"
   * ```
   */
  readonly getState: <TNode extends AnyNodeDefinition>(
    node: TNode,
  ) => NodeRuntimeState<RuntimeNodeData<TNode>>;
  /**
   * Sets a {@link defineContextNode}-defined node's value. Every data or
   * derived node that lists it as a dependency invalidates and
   * recomputes/refetches accordingly.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineContextNode } from "vue-dependency-graph/core";
   *
   * const currentProductId = defineContextNode({ key: "currentProductId", initialValue: "prod-1" });
   * const runtime = createGraphRuntime(createGraph({ nodes: [currentProductId] }));
   *
   * runtime.setContext(currentProductId, "prod-42");
   * ```
   */
  readonly setContext: <TValue>(node: ContextNodeDefinition<TValue>, value: TValue) => void;
  /**
   * Ensures the given nodes (and their dependencies) have a value loaded,
   * loading whichever ones are missing or invalidated. Resolves once
   * every node has settled - successfully or with an error, which is
   * recorded on the node's state rather than thrown here.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineDataNode } from "vue-dependency-graph/core";
   *
   * const product = defineDataNode({
   *   key: "product",
   *   initialValue: null,
   *   load: async () => fetch("/api/products/prod-1").then((r) => r.json()),
   * });
   * const runtime = createGraphRuntime(createGraph({ nodes: [product] }));
   *
   * await runtime.execute([product]);
   * console.log(runtime.getState(product).data);
   * ```
   *
   * @see {@link GraphRuntime.refresh} to force a reload even when the node
   * already has a fresh value.
   */
  readonly execute: (nodes: readonly AnyNodeDefinition[]) => Promise<void>;
  /**
   * Like {@link GraphRuntime.execute}, but intended for warming the graph
   * ahead of a navigation or interaction - e.g. loading a product's data
   * while its card is still just visible in a list, before the user clicks
   * into it.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineDataNode } from "vue-dependency-graph/core";
   *
   * declare const product: ReturnType<typeof defineDataNode<unknown>>;
   * const runtime = createGraphRuntime(createGraph({ nodes: [product] }));
   *
   * // On hover, start loading before the user actually navigates.
   * await runtime.prefetch([product]);
   * ```
   */
  readonly prefetch: (nodes: readonly AnyNodeDefinition[]) => Promise<void>;
  /** {@link GraphRuntime.prefetch}, for every node a {@link defineQuery} bundles together. */
  readonly prefetchQuery: (query: AnyQueryDefinition) => Promise<void>;
  /**
   * Forces the given nodes to reload, even if their current value is
   * still fresh. Use this for an explicit "refresh" action (a pull-to-
   * refresh gesture, a retry button) - for automatic refetching, prefer a
   * node's own `refresh` policy ({@link staleAfter}, {@link refreshInterval}).
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineDataNode } from "vue-dependency-graph/core";
   *
   * declare const inventory: ReturnType<typeof defineDataNode<unknown>>;
   * const runtime = createGraphRuntime(createGraph({ nodes: [inventory] }));
   *
   * await runtime.refresh([inventory]);
   * ```
   */
  readonly refresh: (nodes: readonly RefreshableNodeDefinition[]) => Promise<void>;
  /** {@link GraphRuntime.refresh}, for every refreshable node a {@link defineQuery} bundles together. */
  readonly refreshQuery: (query: AnyQueryDefinition) => Promise<void>;
  /**
   * Publishes an event, running its `when` predicates and invalidating
   * every node whose `invalidatedBy` matches. Typically called from a
   * websocket message handler or similar external push, rather than from
   * ordinary application logic.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineEvent } from "vue-dependency-graph/core";
   *
   * const stockChanged = defineEvent<{ productId: string; inStock: boolean }>("stock-changed");
   * const runtime = createGraphRuntime(createGraph({ nodes: [] }));
   *
   * // e.g. inside a websocket `onmessage` handler:
   * runtime.publish(stockChanged, { productId: "prod-1", inStock: false });
   * ```
   *
   * @see {@link defineDataNode}'s `invalidatedBy` option for how nodes
   * subscribe to an event.
   */
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
  /**
   * Runs a {@link defineMutation}-defined mutation: applies its optimistic
   * update (if any), performs the write, and reconciles the result -
   * rolling the optimistic update back on failure. Rejects with a
   * {@link GraphMutationError} subclass (see {@link defineMutation}) rather
   * than the mutation's own thrown error, so callers can distinguish "the
   * write failed and rolled back cleanly" from "the outcome is unknown"
   * (e.g. a dropped connection after a payment was submitted). Catch
   * {@link GraphMutationError} for a broad handler, or a specific subclass
   * (or `switch` on `.code`) to handle one failure differently.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineMutation } from "vue-dependency-graph/core";
   *
   * declare const addToCart: ReturnType<typeof defineMutation<{ productId: string }, void>>;
   * const runtime = createGraphRuntime(createGraph({ nodes: [] }));
   *
   * await runtime.mutate(addToCart, { productId: "prod-1" });
   * ```
   *
   * @example Handling failure broadly, or by specific cause
   * ```ts
   * import { GraphMutationError } from "vue-dependency-graph/core";
   *
   * try {
   *   await runtime.mutate(addToCart, { productId: "prod-1" });
   * } catch (error) {
   *   if (error instanceof GraphMutationError) {
   *     reportMutationFailure(error.code, error);
   *   } else {
   *     throw error;
   *   }
   * }
   * ```
   */
  readonly mutate: <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    options?: MutationOptions<TInput, TResult>,
  ) => Promise<TResult>;
  /**
   * Registers interest in the given nodes, keeping their values loaded and
   * their `refresh`/`release` policies active for as long as the
   * subscription is open. Call `unsubscribe()` when the consumer no
   * longer needs them (e.g. a component unmounts) - the Vue composables
   * ({@link useNode}, {@link useNodes}, {@link useQuery}) manage this
   * automatically, so most application code won't call it directly.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineDataNode } from "vue-dependency-graph/core";
   *
   * declare const product: ReturnType<typeof defineDataNode<unknown>>;
   * const runtime = createGraphRuntime(createGraph({ nodes: [product] }));
   *
   * const subscription = runtime.subscribeNodes([product]);
   * // ... later, e.g. on unmount:
   * subscription.unsubscribe();
   * ```
   */
  readonly subscribeNodes: (nodes: readonly AnyNodeDefinition[]) => NodeSubscription;
  /** Whether, and through what, a node currently has subscribers - see {@link GraphRuntime.subscribeNodes}. */
  readonly getSubscriptionState: (node: AnyNodeDefinition) => NodeSubscriptionState;
  /** Shorthand for `getSubscriptionState(node)` having any active subscriber. */
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  /** A snapshot of the scheduler's internal state - mainly useful for devtools and diagnostics tooling. */
  readonly getSchedulerState: () => SchedulerState;
  /**
   * Resolves once every currently in-flight load, refresh, and mutation
   * has settled. Useful in tests to wait out a batch of async work
   * without polling.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineDataNode } from "vue-dependency-graph/core";
   *
   * declare const product: ReturnType<typeof defineDataNode<unknown>>;
   * const runtime = createGraphRuntime(createGraph({ nodes: [product] }));
   *
   * void runtime.execute([product]);
   * await runtime.whenSettled();
   * ```
   */
  readonly whenSettled: () => Promise<void>;
  /**
   * Registers a listener called after any change to runtime state - a
   * node's value, status, or subscription count. Returns an unsubscribe
   * function. Low-level: the Vue composables use this internally to
   * drive reactivity, so application code built on Vue rarely needs it
   * directly.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime } from "vue-dependency-graph/core";
   *
   * const runtime = createGraphRuntime(createGraph({ nodes: [] }));
   *
   * const unsubscribe = runtime.onChange(() => {
   *   console.log("something changed");
   * });
   * unsubscribe();
   * ```
   */
  readonly onChange: (listener: RuntimeListener) => () => void;
  /**
   * Captures a point-in-time snapshot of recorded diagnostic events, for
   * export or inspection. Only produces data when the runtime was created
   * with `diagnostics` enabled ({@link GraphRuntimeOptions.diagnostics});
   * otherwise the snapshot is empty.
   */
  readonly createDiagnosticSnapshot: () => GraphDiagnosticSnapshotV1;
  /**
   * Runs `work` in its own isolated transaction session. Context writes and
   * event publications made through the handle are staged and committed
   * atomically when `work` succeeds; failure discards them, and a staged
   * context that an independent write changed first rejects the commit with
   * `GraphTransactionConflictError`. Only the explicit handle (including
   * `transaction.transaction(...)`) joins the same session - a separate
   * `runtime.transaction(...)` call never does. Transactions are local to
   * the graph and do not roll back remote work.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime, defineContextNode } from "vue-dependency-graph/core";
   *
   * const currentOrderId = defineContextNode({ key: "currentOrderId", initialValue: "" });
   * const runtime = createGraphRuntime(createGraph({ nodes: [currentOrderId] }));
   *
   * // Checkout: reserve stock and set the new order id atomically.
   * await runtime.transaction(async (tx) => {
   *   tx.setContext(currentOrderId, "order-123");
   * });
   * ```
   */
  readonly transaction: <T>(work: (transaction: GraphTransaction) => T | Promise<T>) => Promise<T>;
  /**
   * Releases the runtime's long-lived background resources: refresh-policy
   * and release-policy timers, and the refresh policy's subscription to the
   * timer environment's pause signal. After disposal no policy timer fires,
   * policies stop reconciling, and no idle value is released.
   *
   * Deliberately narrow: it does not abort in-flight loads, reject later
   * calls, or clear state and subscriptions - reads, `execute`, `refresh`,
   * `mutate` and existing subscriptions keep working. Idempotent.
   *
   * @example
   * ```ts
   * import { createGraph, createGraphRuntime } from "vue-dependency-graph/core";
   *
   * const runtime = createGraphRuntime(createGraph({ nodes: [] }));
   * // ... application lifetime ...
   * runtime.dispose();
   * ```
   */
  readonly dispose: () => void;
}
