import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { ContextNodeDefinition } from "../graph/types";
import { GraphTransactionConflictError } from "./errors";
import type {
  ContextChange,
  EventPublication,
  GraphTransaction,
  TransactionCommitContext,
} from "./types";

export interface RuntimeTransactionCoordinator {
  readonly runTransaction: <T>(
    work: (transaction: GraphTransaction) => T | Promise<T>,
    commitContext: TransactionCommitContext,
  ) => Promise<T>;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue,
  ) => void;
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
}

interface StagedContextChange extends ContextChange {
  readonly expectedGeneration: number;
}

/**
 * All staged state for one `runtime.transaction(...)` call, owned by that
 * call alone. Replaces the previous module-level `stagedContexts` /
 * `stagedEvents` shared across every open transaction on
 * the runtime -- see ADR-005 "Session ownership and composition".
 * Two calls to `runtime.transaction(...)` never share a session unless one
 * explicitly reuses a handle it was already given.
 */
interface TransactionSession {
  readonly stagedContexts: Map<string, StagedContextChange>;
  readonly stagedEvents: EventPublication[];
  readonly commitContext: TransactionCommitContext;
  settled: boolean;
}

export interface RuntimeTransactionCoordinatorDependencies {
  readonly resolveContextNode: <TValue>(
    node: ContextNodeDefinition<TValue>,
  ) => ContextNodeDefinition<TValue>;
  readonly getContextGeneration: (
    node: ContextNodeDefinition<unknown>,
  ) => number;
  readonly commitImmediate: (
    contextChanges: readonly ContextChange[],
    eventPublications: readonly EventPublication[],
  ) => void;
  readonly commitTransaction: (
    contextChanges: readonly ContextChange[],
    eventPublications: readonly EventPublication[],
    commitContext: TransactionCommitContext,
  ) => void;
}

/**
 * Owns runtime transaction lifecycle and transaction-local context/event work.
 * Notification dispatch remains a separate capability.
 *
 * Each `runtime.transaction(...)` call gets its own independent
 * `TransactionSession` -- there is no shared "currently open transaction"
 * state on this coordinator for a second, unrelated call to observe or
 * join. Composing further work into an already-open transaction is only
 * possible by explicitly reusing the `GraphTransaction` handle that call
 * already received (see `docs/decisions/ADR-005-atomic-graph-
 * transactions.md`, "Session ownership and composition", and
 * `docs/implementation/114-transaction-overlap-isolation-plan.md`).
 */
export const createRuntimeTransactionCoordinator = ({
  resolveContextNode,
  getContextGeneration,
  commitImmediate,
  commitTransaction,
}: RuntimeTransactionCoordinatorDependencies): RuntimeTransactionCoordinator => {
  const commitSession = (session: TransactionSession): void => {
    const conflicts = [...session.stagedContexts.values()]
      .filter(({ node, expectedGeneration }) =>
        getContextGeneration(node) !== expectedGeneration,
      )
      .map(({ node }) => node.key);
    if (conflicts.length > 0) {
      throw new GraphTransactionConflictError(conflicts);
    }

    commitTransaction(
      [...session.stagedContexts.values()].map(({ node, value }) => ({
        node,
        value,
      })),
      session.stagedEvents,
      session.commitContext,
    );
  };

  const stageContext = <TValue>(
    session: TransactionSession,
    node: ContextNodeDefinition<TValue>,
    value: TValue,
  ): void => {
    const registered = resolveContextNode(node);
    const existing = session.stagedContexts.get(registered.key);
    session.stagedContexts.set(registered.key, {
      node: registered as ContextNodeDefinition<unknown>,
      value,
      expectedGeneration:
        existing?.expectedGeneration ??
        getContextGeneration(registered as ContextNodeDefinition<unknown>),
    });
  };

  const stagePublication = <TEvent extends AnyEventDefinition>(
    session: TransactionSession,
    event: TEvent,
    payload: EventPayload<TEvent>,
  ): void => {
    session.stagedEvents.push({ event, payload });
  };

  const createGraphTransaction = (
    session: TransactionSession,
  ): GraphTransaction => {
    const assertActive = (): void => {
      if (session.settled) {
        throw new Error("Graph transaction is no longer active.");
      }
    };

    return Object.freeze({
      setContext: <TValue>(
        node: ContextNodeDefinition<TValue>,
        value: TValue,
      ): void => {
        assertActive();
        stageContext(session, node, value);
      },
      publish: <TEvent extends AnyEventDefinition>(
        event: TEvent,
        payload: EventPayload<TEvent>,
      ): void => {
        assertActive();
        stagePublication(session, event, payload);
      },
      transaction: <T>(
        work: (transaction: GraphTransaction) => T | Promise<T>,
      ): Promise<T> => {
        assertActive();
        // Deliberately the same `session` -- no new commit boundary, no
        // new session. This is an ordinary awaited nested call: if `work`
        // throws and the caller doesn't catch it, the *outer* work throws
        // too, and this session's own `commitSession` is simply never
        // reached. Ordinary control flow does the rollback here; nothing
        // bespoke is needed because there is no other, independently
        // racing participant to coordinate with (see C3 in
        // docs/implementation/114-transaction-overlap-isolation-plan.md
        // for why that coordination was removable).
        return Promise.resolve(work(createGraphTransaction(session)));
      },
    });
  };

  const runTransaction = async <T>(
    work: (transaction: GraphTransaction) => T | Promise<T>,
    commitContext: TransactionCommitContext,
  ): Promise<T> => {
    const session: TransactionSession = {
      stagedContexts: new Map<string, StagedContextChange>(),
      stagedEvents: [],
      commitContext,
      settled: false,
    };
    const transaction = createGraphTransaction(session);
    let succeeded = false;

    try {
      const result = await work(transaction);
      succeeded = true;
      return result;
    } finally {
      session.settled = true;
      if (succeeded) commitSession(session);
      // else: nothing to do -- this session's own staged maps are simply
      // discarded, never having been reachable from anywhere else.
    }
  };

  const setContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue,
  ): void => {
    const registered = resolveContextNode(node);
    const change: ContextChange = {
      node: registered as ContextNodeDefinition<unknown>,
      value,
    };

    commitImmediate([change], []);
  };

  const publish = <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ): void => {
    const publication: EventPublication = { event, payload };
    commitImmediate([], [publication]);
  };

  return Object.freeze({
    runTransaction,
    setContext,
    publish,
  });
};
