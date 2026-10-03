/** The runtime has permanently ended its lifetime. Remote writes may still have occurred. */
export class GraphRuntimeShutdownError extends Error {
  public constructor() {
    super("Graph runtime has been shut down.");
    this.name = "GraphRuntimeShutdownError";
  }
}
