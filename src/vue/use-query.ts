import { computed } from "vue";
import type { AnyNodeDefinition, AnyQueryDefinition, QueryNodes } from "../core";
import { resolveGraphRuntime, type GraphComposableOptions } from "./composable-options";
import { assertActiveEffectScope } from "./scope-guard";
import { useNodes, type UseNodesAggregate } from "./use-nodes";
import type { UseNodeResult } from "./use-node";

export type UseQueryNodes<TQuery extends AnyQueryDefinition> = {
  readonly [
    TAlias in keyof QueryNodes<TQuery>
  ]: QueryNodes<TQuery>[TAlias] extends AnyNodeDefinition
    ? UseNodeResult<QueryNodes<TQuery>[TAlias]>
    : never;
};

export interface UseQueryResult<TQuery extends AnyQueryDefinition> extends UseNodesAggregate {
  readonly nodes: UseQueryNodes<TQuery>;
  readonly prefetch: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

/**
 * Subscribes to every node in an immutable query definition and exposes
 * individual node results through the query's declared aliases.
 *
 * `useNodes(...)` remains the single subscription and observation path, so
 * query consumers retain its aggregate semantics and scope cleanup without
 * introducing query-owned runtime state.
 */
export const useQuery = <TQuery extends AnyQueryDefinition>(
  query: TQuery,
  options?: GraphComposableOptions,
): UseQueryResult<TQuery> => {
  assertActiveEffectScope("useQuery");
  const runtime = resolveGraphRuntime(options);

  const aliases = Object.keys(query.nodes);
  const definitions = aliases.map((alias) => {
    const definition = query.nodes[alias];
    if (definition === undefined) {
      throw new Error(`Query is missing a node definition for alias '${alias}'.`);
    }
    return definition;
  });
  const queryResult = useNodes(definitions, { runtime });

  const nodes = Object.fromEntries(
    aliases.map((alias, index) => {
      const state = queryResult.results[index];
      if (state === undefined) {
        throw new Error(`Query result is missing state for alias '${alias}'.`);
      }

      return [
        alias,
        Object.freeze({
          data: computed(() => state.value.data),
          status: computed(() => state.value.status),
          freshness: computed(() => state.value.freshness),
          error: computed(() => state.value.error),
          hasSuccessfulValue: computed(() => state.value.hasSuccessfulValue),
        }),
      ];
    }),
  ) as unknown as UseQueryNodes<TQuery>;

  return {
    nodes: Object.freeze(nodes),
    isLoading: queryResult.isLoading,
    isError: queryResult.isError,
    errors: queryResult.errors,
    isSuccess: queryResult.isSuccess,
    prefetch: () => runtime.prefetchQuery(query),
    refresh: () => runtime.refreshQuery(query),
  };
};
