export class EventPredicateDependencyError extends Error {
  public readonly nodeKey: string;
  public readonly dependencyKey: string;

  public constructor(nodeKey: string, dependencyKey: string) {
    super(
      `Node "${nodeKey}" event predicate cannot read prohibited dependency "${dependencyKey}".`,
    );
    this.name = "EventPredicateDependencyError";
    this.nodeKey = nodeKey;
    this.dependencyKey = dependencyKey;
  }
}
