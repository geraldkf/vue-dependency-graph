export class GraphTransactionConflictError extends Error {
  readonly contextKeys: readonly string[];

  constructor(contextKeys: readonly string[]) {
    const keys = [...contextKeys].sort();
    super(`Graph transaction conflicted with context changes: ${keys.join(", ")}.`);
    this.name = "GraphTransactionConflictError";
    this.contextKeys = Object.freeze(keys);
  }
}
