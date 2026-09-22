import type { AnyNodeDefinition } from "../graph/types";
import type { RefreshableNodeDefinition } from "../operations/types";
import type {
  AnyQueryDefinition,
  DefineQueryOptions,
  QueryDefinition,
  QueryNodeMap,
} from "./types";

/**
 * Bundles several nodes into a single named result, so a component or page
 * can request everything it needs in one call rather than juggling
 * individual nodes. A product page might query the product, its reviews,
 * and current stock together; a checkout page might query the cart, its
 * total, and available shipping options.
 *
 * A query is a read-time grouping only - it doesn't add nodes to the
 * graph or change how they load. `nodes` maps a short alias to each node
 * definition; the alias is what you'll destructure from
 * {@link useQuery}'s result.
 *
 * @throws {@link Error} if `key`, or any node alias, is empty or only whitespace.
 *
 * @example
 * ```ts
 * import { defineDataNode, defineDerivedNode, defineQuery } from "vue-dependency-graph/core";
 *
 * declare const product: ReturnType<typeof defineDataNode<unknown>>;
 * declare const productReviews: ReturnType<typeof defineDataNode<unknown>>;
 * declare const averageRating: ReturnType<typeof defineDerivedNode<number, never>>;
 *
 * const productPageQuery = defineQuery({
 *   key: "productPage",
 *   nodes: { product, productReviews, averageRating },
 * });
 *
 * // Elsewhere, in a Vue component:
 * // const { product, productReviews, averageRating } = useQuery(productPageQuery);
 * ```
 *
 * @see {@link useQuery} for reading a query's nodes reactively in a Vue component.
 * @see {@link GraphRuntime.prefetchQuery} / {@link GraphRuntime.refreshQuery}
 * for loading or refreshing every node a query bundles at once.
 */
export const defineQuery = <const TNodes extends QueryNodeMap>(
  options: DefineQueryOptions<TNodes>,
): QueryDefinition<TNodes> => {
  if (options.key.trim().length === 0) {
    throw new Error("Query key must not be blank.");
  }

  for (const alias of Object.keys(options.nodes)) {
    if (alias.trim().length === 0) {
      throw new Error("Query node alias must not be blank.");
    }
  }

  return Object.freeze({
    key: options.key,
    nodes: Object.freeze({ ...options.nodes }) as TNodes,
  });
};

export const getQueryNodes = (query: AnyQueryDefinition): readonly AnyNodeDefinition[] =>
  Object.freeze(Object.values(query.nodes));

export const getQueryRefreshableNodes = (
  query: AnyQueryDefinition,
): readonly RefreshableNodeDefinition[] =>
  Object.freeze(
    getQueryNodes(query).filter(
      (node): node is RefreshableNodeDefinition => node.kind === "data" || node.kind === "derived",
    ),
  );
