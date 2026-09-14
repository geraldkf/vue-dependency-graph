import type {
  AnyEventDefinition,
  EventPayload,
} from "../events/event";
import type { ContextNodeDefinition } from "../graph/node";
import type {
  ContextChange,
  EventPublication,
} from "./types";

export interface RuntimeTransactionCoordinator {
  readonly runTransaction: <T>(
    work: () => T | Promise<T>
  ) => Promise<T>;
  readonly isInsideTransaction: () => boolean;
  readonly assertOperationAllowed: (operation: string) => void;
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ) => void;
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>
  ) => void;
}

export interface RuntimeTransactionCoordinatorDependencies {
  readonly runWithBufferedNotifications: <T>(
    work: () => T | Promise<T>
  ) => Promise<T>;
  readonly resolveContextNode: <TValue>(
    node: ContextNodeDefinition<TValue>
  ) => ContextNodeDefinition<TValue>;
  readonly commit: (
    contextChanges: readonly ContextChange[],
    eventPublications: readonly EventPublication[]
  ) => void;
}

/**
 * Owns runtime transaction lifecycle and transaction-local context/event work.
 * Notification dispatch remains a separate capability.
 */
export const createRuntimeTransactionCoordinator = ({
  runWithBufferedNotifications,
  resolveContextNode,
  commit,
}: RuntimeTransactionCoordinatorDependencies): RuntimeTransactionCoordinator => {
  let depth = 0;
  let rootSucceeded = false;
  let resolveJoinedTransactions: (() => void) | undefined;
  let joinedTransactionsSettled: Promise<void> | undefined;
  let stagedContexts = new Map<string, ContextChange>();
  let stagedEvents: EventPublication[] = [];

  const commitStagedWork = (): void => {
    const contexts = stagedContexts;
    const events = stagedEvents;
    stagedContexts = new Map();
    stagedEvents = [];

    commit([...contexts.values()], events);
  };

  const discardStagedWork = (): void => {
    stagedContexts = new Map();
    stagedEvents = [];
  };

  const waitForJoinedTransactions = (): Promise<void> => {
    joinedTransactionsSettled ??= new Promise<void>(resolve => {
      resolveJoinedTransactions = resolve;
    });
    return joinedTransactionsSettled;
  };

  const resetJoinedTransactionSettlement = (): void => {
    resolveJoinedTransactions = undefined;
    joinedTransactionsSettled = undefined;
  };

  const runTransaction = <T>(
    work: () => T | Promise<T>
  ): Promise<T> =>
    runWithBufferedNotifications(async () => {
      const isRoot = depth === 0;
      let completed = false;

      if (isRoot) rootSucceeded = false;
      depth += 1;

      try {
        const result = await work();
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

          if (rootSucceeded) commitStagedWork();
          else discardStagedWork();
          resetJoinedTransactionSettlement();
        }
      }
    });

  const isInsideTransaction = (): boolean => depth > 0;

  const assertOperationAllowed = (operation: string): void => {
    if (!isInsideTransaction()) return;

    throw new Error(
      `runtime.${operation}(...) cannot be called inside runtime.transaction(...).`
    );
  };

  const setContext = <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ): void => {
    const registered = resolveContextNode(node);
    const change: ContextChange = {
      node: registered as ContextNodeDefinition<unknown>,
      value,
    };

    if (!isInsideTransaction()) {
      commit([change], []);
      return;
    }

    stagedContexts.set(registered.key, change);
  };

  const publish = <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>
  ): void => {
    const publication: EventPublication = { event, payload };
    if (!isInsideTransaction()) {
      commit([], [publication]);
      return;
    }

    stagedEvents.push(publication);
  };

  return Object.freeze({
    runTransaction,
    isInsideTransaction,
    assertOperationAllowed,
    setContext,
    publish,
  });
};
