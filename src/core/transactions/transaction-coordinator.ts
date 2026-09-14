import type { ContextNodeDefinition } from "../graph/node";
import type { ContextChange } from "./types";

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
}

export interface RuntimeTransactionCoordinatorDependencies {
  readonly runWithBufferedNotifications: <T>(
    work: () => T | Promise<T>
  ) => Promise<T>;
  readonly resolveContextNode: <TValue>(
    node: ContextNodeDefinition<TValue>
  ) => ContextNodeDefinition<TValue>;
  readonly commitContexts: (
    changes: readonly ContextChange[]
  ) => void;
}

/**
 * Owns runtime transaction lifecycle and transaction-local context values.
 * Notification dispatch remains a separate capability.
 */
export const createRuntimeTransactionCoordinator = ({
  runWithBufferedNotifications,
  resolveContextNode,
  commitContexts,
}: RuntimeTransactionCoordinatorDependencies): RuntimeTransactionCoordinator => {
  let depth = 0;
  let rootSucceeded = false;
  let resolveJoinedTransactions: (() => void) | undefined;
  let joinedTransactionsSettled: Promise<void> | undefined;
  let stagedContexts = new Map<string, ContextChange>();

  const commitStagedContexts = (): void => {
    const contexts = stagedContexts;
    stagedContexts = new Map();

    commitContexts([...contexts.values()]);
  };

  const discardStagedContexts = (): void => {
    stagedContexts = new Map();
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

          if (rootSucceeded) commitStagedContexts();
          else discardStagedContexts();
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
    if (!isInsideTransaction()) {
      const registered = resolveContextNode(node);
      commitContexts([{
        node: registered as ContextNodeDefinition<unknown>,
        value,
      }]);
      return;
    }

    const registered = resolveContextNode(node);
    stagedContexts.set(registered.key, {
      node: registered as ContextNodeDefinition<unknown>,
      value,
    });
  };

  return Object.freeze({
    runTransaction,
    isInsideTransaction,
    assertOperationAllowed,
    setContext,
  });
};
