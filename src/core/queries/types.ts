import type { AnyNodeDefinition } from "../graph/types";

export type QueryNodeMap = Readonly<Record<string, AnyNodeDefinition>>;

export interface QueryDefinition<TNodes extends QueryNodeMap> {
  readonly key: string;
  readonly nodes: TNodes;
}

export type AnyQueryDefinition = QueryDefinition<QueryNodeMap>;

export type QueryNodes<TQuery extends AnyQueryDefinition> =
  TQuery extends QueryDefinition<infer TNodes> ? TNodes : never;

export interface DefineQueryOptions<TNodes extends QueryNodeMap> {
  readonly key: string;
  readonly nodes: TNodes;
}
