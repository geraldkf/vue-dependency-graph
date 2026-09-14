import type { ContextNodeDefinition } from "../graph/node";

export interface StagedContextValue {
  readonly node: ContextNodeDefinition<unknown>;
  readonly value: unknown;
}

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
    changes: readonly StagedContextValue[]
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
  let stagedContexts = new Map<string, StagedContextValue>();

  const commitStagedContexts = (): void => {
    const contexts = stagedContexts;
    stagedContexts = new Map();

    commitContexts([...contexts.values()]);
  };

  const discardStagedContexts = (): void => {
    stagedContexts = new Map();
  };

  const runTransaction = <T>(
    work: () => T | Promise<T>
  ): Promise<T> =>
    runWithBufferedNotifications(async () => {
      let completed = false;
      depth += 1;
      try {
        const result = await work();
        completed = true;
        return result;
      } finally {
        depth -= 1;
        if (depth === 0) {
          if (completed) commitStagedContexts();
          else discardStagedContexts();
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
