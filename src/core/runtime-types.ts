import type {
  NodeSubscription,
  NodeSubscriptionState,
} from "./subscriptions/types";
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
   * no subscribers - direct or required. A node's own `release` policy,
   * when declared, always takes precedence over this default, including
   * `retain()`, which opts a node out even when this default is set.
   * Omitted entirely, no automatic release happens for any node unless it
   * declares its own `release: releaseAfter(...)`. See
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
  readonly getState: <TNode extends AnyNodeDefinition>(
    node: TNode,
  ) => NodeRuntimeState<RuntimeNodeData<TNode>>;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue,
  ) => void;
  readonly execute: (nodes: readonly AnyNodeDefinition[]) => Promise<void>;
  readonly prefetch: (nodes: readonly AnyNodeDefinition[]) => Promise<void>;
  readonly prefetchQuery: (query: AnyQueryDefinition) => Promise<void>;
  readonly refresh: (
    nodes: readonly RefreshableNodeDefinition[],
  ) => Promise<void>;
  readonly refreshQuery: (query: AnyQueryDefinition) => Promise<void>;
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
  readonly mutate: <TInput, TResult>(
    mutation: MutationDefinition<TInput, TResult>,
    input: TInput,
    options?: MutationOptions<TInput, TResult>,
  ) => Promise<TResult>;
  readonly subscribeNodes: (
    nodes: readonly AnyNodeDefinition[],
  ) => NodeSubscription;
  readonly getSubscriptionState: (
    node: AnyNodeDefinition,
  ) => NodeSubscriptionState;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  readonly getSchedulerState: () => SchedulerState;
  readonly whenSettled: () => Promise<void>;
  readonly onChange: (listener: RuntimeListener) => () => void;
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
   */
  readonly transaction: <T>(
    work: (transaction: GraphTransaction) => T | Promise<T>,
  ) => Promise<T>;
  /**
   * Releases the runtime's long-lived background resources: refresh-policy
   * and release-policy timers, and the refresh policy's subscription to the
   * timer environment's pause signal. After disposal no policy timer fires,
   * policies stop reconciling, and no idle value is released.
   *
   * Deliberately narrow: it does not abort in-flight loads, reject later
   * calls, or clear state and subscriptions - reads, `execute`, `refresh`,
   * `mutate` and existing subscriptions keep working. Idempotent.
   */
  readonly dispose: () => void;
}
