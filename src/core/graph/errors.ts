export type GraphValidationErrorCode =
  | "INVALID_NODE_KEY"
  | "DUPLICATE_NODE_KEY"
  | "DUPLICATE_DEPENDENCY"
  | "INVALID_EVENT_KEY"
  | "INVALID_EVENT_DECLARATION"
  | "DUPLICATE_EVENT_INVALIDATION"
  | "MISSING_DEPENDENCY"
  | "CIRCULAR_DEPENDENCY";

export class GraphValidationError extends Error {
  public constructor(
    public readonly code: GraphValidationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GraphValidationError";
  }
}
