export type NodeKind = "context" | "data" | "derived";

export interface NodeDefinition<
  TValue,
  TKind extends NodeKind = NodeKind,
  TDependencies extends readonly AnyNodeDefinition[] = readonly AnyNodeDefinition[],
> {
  readonly key: string;
  readonly kind: TKind;
  readonly dependencies: TDependencies;
  /** Carries TValue for type inference without storing runtime state. */
  readonly __valueType?: TValue;
}

export type AnyNodeDefinition = NodeDefinition<unknown, NodeKind, readonly AnyNodeDefinition[]>;

export type NodeValue<TNode extends AnyNodeDefinition> =
  TNode extends NodeDefinition<infer TValue, NodeKind, readonly AnyNodeDefinition[]>
    ? TValue
    : never;

export type DependencyList = readonly AnyNodeDefinition[];
export type DependencySource<TDependencies extends DependencyList> =
  | TDependencies
  | (() => TDependencies);

export type GetDependencyValue<TDependencies extends DependencyList> = <
  TNode extends TDependencies[number],
>(node: TNode) => NodeValue<TNode>;

export interface LoadContext<TDependencies extends DependencyList> {
  readonly get: GetDependencyValue<TDependencies>;
  readonly signal: AbortSignal;
}

export interface DeriveContext<TDependencies extends DependencyList> {
  readonly get: GetDependencyValue<TDependencies>;
}

export interface ContextNodeDefinition<TValue>
  extends NodeDefinition<TValue, "context", readonly []> {
  readonly initialValue: TValue;
}

export interface DataNodeDefinition<
  TValue,
  TDependencies extends DependencyList,
> extends NodeDefinition<TValue, "data", TDependencies> {
  readonly initialValue: TValue;
  readonly load: (context: LoadContext<TDependencies>) => Promise<TValue>;
}

export interface DerivedNodeDefinition<
  TValue,
  TDependencies extends DependencyList,
> extends NodeDefinition<TValue, "derived", TDependencies> {
  readonly derive: (context: DeriveContext<TDependencies>) => TValue;
}

export interface ContextNodeOptions<TValue> {
  readonly key: string;
  readonly initialValue: TValue;
}

export interface DataNodeOptions<
  TValue,
  TDependencies extends DependencyList = readonly [],
> {
  readonly key: string;
  readonly dependencies?: DependencySource<TDependencies>;
  readonly initialValue: TValue;
  readonly load: (context: LoadContext<TDependencies>) => Promise<TValue>;
}

export interface DerivedNodeOptions<
  TValue,
  TDependencies extends DependencyList,
> {
  readonly key: string;
  readonly dependencies: DependencySource<TDependencies>;
  readonly derive: (context: DeriveContext<TDependencies>) => TValue;
}

export type NodeOrKey = AnyNodeDefinition | string;

export interface Graph {
  readonly getNode: (key: string) => AnyNodeDefinition | undefined;
  readonly hasNode: (key: string) => boolean;
  readonly getParents: (nodeOrKey: NodeOrKey) => readonly AnyNodeDefinition[];
  readonly getChildren: (nodeOrKey: NodeOrKey) => readonly AnyNodeDefinition[];
  readonly getNodes: () => readonly AnyNodeDefinition[];
}
