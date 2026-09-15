const normalizeNodeKeys = (nodeKeys: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(nodeKeys)].sort());

export class GraphMutationStateError extends Error {
  public readonly nodeKey: string;

  public constructor(nodeKey: string, message: string) {
    super(message);
    this.name = "GraphMutationStateError";
    this.nodeKey = nodeKey;
  }
}

export class GraphMutationConflictError extends Error {
  public readonly nodeKeys: readonly string[];

  public constructor(nodeKeys: readonly string[]) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super(`Optimistic mutation conflicts with active nodes: ${sortedKeys.join(", ")}.`);
    this.name = "GraphMutationConflictError";
    this.nodeKeys = sortedKeys;
  }
}

export class GraphMutationOutcomeUnknownError extends Error {
  public readonly nodeKeys: readonly string[];

  public constructor(nodeKeys: readonly string[], cause: unknown) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super(
      `Mutation outcome is unknown for nodes: ${sortedKeys.join(", ")}.`,
      { cause },
    );
    this.name = "GraphMutationOutcomeUnknownError";
    this.nodeKeys = sortedKeys;
  }
}


export class GraphMutationReconciliationError extends Error {
  public readonly mutationKey: string;
  public readonly nodeKeys: readonly string[];
  public readonly remoteSucceeded = true as const;

  public constructor(
    mutationKey: string,
    nodeKeys: readonly string[],
    cause: unknown,
  ) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super(
      `Mutation "${mutationKey}" succeeded remotely but local reconciliation failed for nodes: ${sortedKeys.join(", ")}.`,
      { cause },
    );
    this.name = "GraphMutationReconciliationError";
    this.mutationKey = mutationKey;
    this.nodeKeys = sortedKeys;
  }
}

export class GraphMutationRollbackConflictError extends Error {
  public readonly nodeKeys: readonly string[];

  public constructor(nodeKeys: readonly string[], cause: unknown) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super(
      `Optimistic rollback conflicts with newer graph state for nodes: ${sortedKeys.join(", ")}.`,
      { cause },
    );
    this.name = "GraphMutationRollbackConflictError";
    this.nodeKeys = sortedKeys;
  }
}
