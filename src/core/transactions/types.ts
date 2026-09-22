import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { ContextNodeDefinition } from "../graph/types";

export interface ContextChange {
  readonly node: ContextNodeDefinition<unknown>;
  readonly value: unknown;
}

export interface EventPublication {
  readonly event: AnyEventDefinition;
  readonly payload: unknown;
}

export interface TransactionCommitContext {
  readonly operationId: string;
}

export interface GraphTransaction {
  readonly setContext: <TValue>(node: ContextNodeDefinition<TValue>, value: TValue) => void;
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
  /**
   * Nests further transactional work into the same transaction as this
   * handle, sharing its staged context/event state and its eventual
   * commit-or-rollback outcome. This is the only supported way to compose
   * work into an already-open transaction -- calling `runtime.transaction(
   * ...)` again from inside a callback does not join this one; it starts
   * a fully independent transaction (see ADR-005, "Amendment: isolated
   * transaction sessions"). Use this method instead whenever the intent is
   * genuine composition rather than two unrelated operations that happen
   * to overlap in time.
   */
  readonly transaction: <T>(work: (transaction: GraphTransaction) => T | Promise<T>) => Promise<T>;
}
