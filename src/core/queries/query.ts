import type { AnyNodeDefinition } from "../graph/types";
import type { RefreshableNodeDefinition } from "../operations/types";
import type {
  AnyQueryDefinition,
  DefineQueryOptions,
  QueryDefinition,
  QueryNodeMap,
} from "./types";

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
