export interface RuntimeTransactionCoordinator {
  readonly runTransaction: <T>(
    work: () => T | Promise<T>
  ) => Promise<T>;
  readonly isInsideTransaction: () => boolean;
  readonly assertOperationAllowed: (operation: string) => void;
}

export interface RuntimeTransactionCoordinatorDependencies {
  readonly runWithBufferedNotifications: <T>(
    work: () => T | Promise<T>
  ) => Promise<T>;
}

/**
 * Owns runtime transaction lifecycle independently from notification
 * buffering. State staging and commit/rollback participants will be added to
 * this coordinator in later Milestone 5 slices.
 */
export const createRuntimeTransactionCoordinator = ({
  runWithBufferedNotifications,
}: RuntimeTransactionCoordinatorDependencies): RuntimeTransactionCoordinator => {
  let depth = 0;

  const runTransaction = <T>(
    work: () => T | Promise<T>
  ): Promise<T> =>
    runWithBufferedNotifications(async () => {
      depth += 1;
      try {
        return await work();
      } finally {
        depth -= 1;
      }
    });

  const isInsideTransaction = (): boolean => depth > 0;

  const assertOperationAllowed = (operation: string): void => {
    if (!isInsideTransaction()) return;

    throw new Error(
      `runtime.${operation}(...) cannot be called inside runtime.transaction(...).`
    );
  };

  return Object.freeze({
    runTransaction,
    isInsideTransaction,
    assertOperationAllowed,
  });
};
