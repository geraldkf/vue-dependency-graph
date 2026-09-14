import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { ContextNodeDefinition } from "../graph/types";
import { GraphTransactionConflictError } from "./errors";
import type {
  ContextChange,
  EventPublication,
  GraphTransaction,
} from "./types";

export interface RuntimeTransactionCoordinator {
  readonly runTransaction: <T>(
    work: (transaction: GraphTransaction) => T | Promise<T>,
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

export interface RuntimeTransactionCoordinatorDependencies {
  readonly runWithBufferedNotifications: <T>(
    work: () => T | Promise<T>,
  ) => Promise<T>;
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
  ) => void;
}

/**
 * Owns runtime transaction lifecycle and transaction-local context/event work.
 * Notification dispatch remains a separate capability.
 */
export const createRuntimeTransactionCoordinator = ({
  runWithBufferedNotifications,
  resolveContextNode,
  getContextGeneration,
  commitImmediate,
  commitTransaction,
}: RuntimeTransactionCoordinatorDependencies): RuntimeTransactionCoordinator => {
  let depth = 0;
  let rootSucceeded = false;
  let resolveJoinedTransactions: (() => void) | undefined;
  let joinedTransactionsSettled: Promise<void> | undefined;
  let stagedContexts = new Map<string, StagedContextChange>();
  let stagedEvents: EventPublication[] = [];
  let activeGroup: symbol | undefined;

  const commitStagedWork = (): void => {
    const contexts = stagedContexts;
    const events = stagedEvents;
    stagedContexts = new Map<string, StagedContextChange>();
    stagedEvents = [];

    const conflicts = [...contexts.values()]
      .filter(({ node, expectedGeneration }) =>
        getContextGeneration(node) !== expectedGeneration,
      )
      .map(({ node }) => node.key);
    if (conflicts.length > 0) {
      throw new GraphTransactionConflictError(conflicts);
    }

    commitTransaction(
      [...contexts.values()].map(({ node, value }) => ({ node, value })),
      events,
    );
  };

  const discardStagedWork = (): void => {
    stagedContexts = new Map<string, StagedContextChange>();
    stagedEvents = [];
  };

  const waitForJoinedTransactions = (): Promise<void> => {
    joinedTransactionsSettled ??= new Promise<void>((resolve) => {
      resolveJoinedTransactions = resolve;
    });
    return joinedTransactionsSettled;
  };

  const resetJoinedTransactionSettlement = (): void => {
    resolveJoinedTransactions = undefined;
    joinedTransactionsSettled = undefined;
  };

  const stageContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue,
  ): void => {
    const registered = resolveContextNode(node);
    const existing = stagedContexts.get(registered.key);
    stagedContexts.set(registered.key, {
      node: registered as ContextNodeDefinition<unknown>,
      value,
      expectedGeneration:
        existing?.expectedGeneration ??
        getContextGeneration(registered as ContextNodeDefinition<unknown>),
    });
  };

  const stagePublication = <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ): void => {
    stagedEvents.push({ event, payload });
  };

  const createGraphTransaction = (group: symbol): GraphTransaction => {
    const assertActive = (): void => {
      if (activeGroup === group) return;
      throw new Error("Graph transaction is no longer active.");
    };

    return Object.freeze({
      setContext: <TValue>(
        node: ContextNodeDefinition<TValue>,
        value: TValue,
      ): void => {
        assertActive();
        stageContext(node, value);
      },
      publish: <TEvent extends AnyEventDefinition>(
        event: TEvent,
        payload: EventPayload<TEvent>,
      ): void => {
        assertActive();
        stagePublication(event, payload);
      },
    });
  };

  const runTransaction = <T>(
    work: (transaction: GraphTransaction) => T | Promise<T>,
  ): Promise<T> =>
    runWithBufferedNotifications(async () => {
      const isRoot = depth === 0;
      let completed = false;

      if (isRoot) {
        rootSucceeded = false;
        activeGroup = Symbol("graph-transaction");
      }
      const group = activeGroup;
      if (!group) throw new Error("Graph transaction group is not active.");
      const transaction = createGraphTransaction(group);
      depth += 1;

      try {
        const result = await work(transaction);
        completed = true;
        return result;
      } finally {
        if (isRoot) rootSucceeded = completed;
        depth -= 1;

        if (!isRoot && depth === 0) {
          resolveJoinedTransactions?.();
        }

        if (isRoot) {
          if (depth > 0) await waitForJoinedTransactions();

          try {
            if (rootSucceeded) commitStagedWork();
            else discardStagedWork();
          } finally {
            activeGroup = undefined;
            resetJoinedTransactionSettlement();
          }
        }
      }
    });

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
