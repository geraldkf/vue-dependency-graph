import type { AnyNodeDefinition } from "../graph/types";

/** A query's `nodes` map: a short alias for each bundled node definition. */
export type QueryNodeMap = Readonly<Record<string, AnyNodeDefinition>>;

/** The definition returned by {@link defineQuery}. */
export interface QueryDefinition<TNodes extends QueryNodeMap> {
  readonly key: string;
  readonly nodes: TNodes;
}

/** A query definition with any node map - used for parameters that accept any query, e.g. {@link GraphRuntime.prefetchQuery}. */
export type AnyQueryDefinition = QueryDefinition<QueryNodeMap>;

/**
 * Extracts a query's node map type from its definition - the shape
 * {@link useQuery} returns values for.
 *
 * @example
 * ```ts
 * import { defineQuery, type QueryNodes } from "vue-dependency-graph/core";
 *
 * declare const productPageQuery: ReturnType<typeof defineQuery>;
 * type ProductPageNodes = QueryNodes<typeof productPageQuery>;
 * ```
 */
export type QueryNodes<TQuery extends AnyQueryDefinition> =
  TQuery extends QueryDefinition<infer TNodes> ? TNodes : never;

/** Options for {@link defineQuery}. */
export interface DefineQueryOptions<TNodes extends QueryNodeMap> {
  /**
   * Unique identifier for this query. Used in diagnostics and error
   * messages - unlike a node key, it isn't looked up elsewhere in the
   * graph.
   */
  readonly key: string;
  /**
   * The nodes this query bundles, each under a short alias. The alias is
   * what a consumer destructures from {@link useQuery}'s result - it
   * doesn't need to match the node's own `key`.
   */
  readonly nodes: TNodes;
}
