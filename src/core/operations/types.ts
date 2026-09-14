import type { AnyNodeDefinition } from "../graph/node";

/**
 * Any registered non-context node may be refreshed, regardless of its
 * dependency tuple or event invalidation declarations.
 */
export type RefreshableNodeDefinition = AnyNodeDefinition & {
  readonly kind: "data" | "derived";
};
