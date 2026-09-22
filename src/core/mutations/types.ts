import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { DataNodeDefinition, DependencyList, EventInvalidationList } from "../graph/types";
import type { RefreshableNodeDefinition } from "../operations/types";

export interface MutationExecuteContext<TInput> {
  readonly input: TInput;
  readonly signal: AbortSignal;
}

export interface MutationDefinition<TInput, TResult> {
  readonly key: string;
  readonly execute: (context: MutationExecuteContext<TInput>) => Promise<TResult>;
  /** Carries TInput for inference without storing runtime state. */
  readonly __inputType?: TInput;
  /** Carries TResult for inference without storing runtime state. */
  readonly __resultType?: TResult;
}

export interface DefineMutationOptions<TInput, TResult> {
  readonly key: string;
  readonly execute: (context: MutationExecuteContext<TInput>) => Promise<TResult>;
}

export type MutationInput<TMutation> = TMutation extends { readonly __inputType?: infer TInput }
  ? TInput
  : never;

export type MutationResult<TMutation> = TMutation extends { readonly __resultType?: infer TResult }
  ? TResult
  : never;

export interface MutationUpdateEffects {
  readonly update: <
    TValue,
    TDependencies extends DependencyList,
    TInvalidatedBy extends EventInvalidationList<TDependencies>,
  >(
    node: DataNodeDefinition<TValue, TDependencies, TInvalidatedBy>,
    updater: (current: TValue) => TValue,
  ) => void;
}

export type MutationFailureKind = "rejected" | "unknown";

export interface MutationSuccessEffects extends MutationUpdateEffects {
  readonly invalidate: (nodes: readonly RefreshableNodeDefinition[]) => void;
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
}

export interface MutationOptions<TInput, TResult> {
  readonly optimistic?: (effects: MutationUpdateEffects, input: TInput) => void;
  readonly onSuccess?: (effects: MutationSuccessEffects, result: TResult, input: TInput) => void;
  readonly classifyFailure?: (error: unknown) => MutationFailureKind;
}
