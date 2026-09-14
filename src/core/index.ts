export { pollUntil, refreshInterval, staleAfter } from "./refresh-policies/policy";
export { GraphPollingConditionError, GraphPollingTimeoutError } from "./refresh-policies/errors";
export type {
  ExponentialRetryOptions,
  ExponentialRetryPolicy,
  FixedRetryOptions,
  FixedRetryPolicy,
  PollUntilOptions,
  PollUntilPolicy,
  RefreshIntervalOptions,
  RefreshIntervalPolicy,
  RefreshPolicy,
  RefreshPolicyEnvironment,
  RetryOptions,
  RetryPolicy,
  RetryStrategy,
  StaleAfterOptions,
  StaleAfterPolicy,
} from "./refresh-policies/types";
export { GraphTransactionConflictError } from "./transactions/errors";
export type { GraphTransaction } from "./transactions/types";
export type { RefreshableNodeDefinition } from "./operations/types";
export type { SchedulerState } from "./scheduling/types";
export type {
  NodeSubscription,
  NodeSubscriptionState,
} from "./subscriptions/types";
export { GraphValidationError } from "./graph/errors";
export type { GraphValidationErrorCode } from "./graph/errors";
export { GraphExecutionError, isAbortError, toError } from "./execution/types";
export type {
  NodeExecutionFailure,
  NodeExecutionFailureKind,
} from "./execution/types";
export { defineEvent } from "./events/event";
export { defineQuery } from "./queries/query";
export type {
  AnyQueryDefinition,
  DefineQueryOptions,
  QueryDefinition,
  QueryNodeMap,
  QueryNodes,
} from "./queries/types";
export type {
  AnyEventDefinition,
  EventDefinition,
  EventPayload,
} from "./events/types";
export { createGraph } from "./graph/graph";
export type { CreateGraphOptions } from "./graph/graph";
export {
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "./graph/node";
export { createGraphRuntime } from "./runtime";
export type { GraphRuntime, GraphRuntimeOptions } from "./runtime";
export type {
  NodeFreshness,
  NodeRuntimeState,
  NodeStatus,
  RuntimeNodeData,
} from "./state/types";
export type { RuntimeListener } from "./observation/types";
export type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  ContextNodeOptions,
  DataNodeDefinition,
  DataNodeOptions,
  ConditionalEventInvalidation,
  DependencyList,
  DeriveContext,
  DerivedNodeDefinition,
  DerivedNodeOptions,
  EventInvalidationContext,
  EventInvalidationDeclaration,
  EventInvalidationList,
  GetDependencyValue,
  Graph,
  LoadContext,
  NodeDefinition,
  NodeKind,
  NodeOrKey,
  NodeValue,
} from "./graph/types";

/** Identifies the framework-agnostic core layer during repository bootstrap. */
export const coreLayerName = "core" as const;
