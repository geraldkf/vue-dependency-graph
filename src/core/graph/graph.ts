import { GraphValidationError } from "./errors";
import type {
  AnyNodeDefinition,
  Graph,
  NodeOrKey,
} from "./node";

export interface CreateGraphOptions {
  readonly nodes: readonly AnyNodeDefinition[];
}

const keyOf = (nodeOrKey: NodeOrKey): string =>
  typeof nodeOrKey === "string" ? nodeOrKey : nodeOrKey.key;

const findCycle = (
  keys: readonly string[],
  parentKeysByNode: ReadonlyMap<string, readonly string[]>
): readonly string[] | undefined => {
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (key: string): readonly string[] | undefined => {
    if (active.has(key)) {
      const cycleStart = path.indexOf(key);
      return [...path.slice(cycleStart), key];
    }
    if (visited.has(key)) return undefined;

    active.add(key);
    path.push(key);

    const parents = [...(parentKeysByNode.get(key) ?? [])].sort();
    for (const parent of parents) {
      const cycle = visit(parent);
      if (cycle) return cycle;
    }

    path.pop();
    active.delete(key);
    visited.add(key);
    return undefined;
  };

  for (const key of [...keys].sort()) {
    const cycle = visit(key);
    if (cycle) return cycle;
  }

  return undefined;
};

export const createGraph = (options: CreateGraphOptions): Graph => {
  const nodes = [...options.nodes];
  const nodesByKey = new Map<string, AnyNodeDefinition>();

  for (const node of nodes) {
    if (nodesByKey.has(node.key)) {
      throw new GraphValidationError(
        "DUPLICATE_NODE_KEY",
        `Duplicate node key "${node.key}".`
      );
    }
    nodesByKey.set(node.key, node);
  }

  const parentKeysByNode = new Map<string, readonly string[]>();
  const childKeysByNode = new Map<string, string[]>();

  for (const node of nodes) {
    childKeysByNode.set(node.key, []);
  }

  for (const node of nodes) {
    const parentKeys: string[] = [];
    const seenDependencies = new Set<string>();

    for (const dependency of node.dependencies) {
      if (seenDependencies.has(dependency.key)) {
        throw new GraphValidationError(
          "DUPLICATE_DEPENDENCY",
          `Node "${node.key}" declares dependency "${dependency.key}" more than once.`
        );
      }
      seenDependencies.add(dependency.key);

      if (!nodesByKey.has(dependency.key)) {
        throw new GraphValidationError(
          "MISSING_DEPENDENCY",
          `Node "${node.key}" references missing dependency "${dependency.key}".`
        );
      }

      parentKeys.push(dependency.key);
      childKeysByNode.get(dependency.key)?.push(node.key);
    }

    parentKeysByNode.set(node.key, Object.freeze(parentKeys));
  }

  for (const children of childKeysByNode.values()) {
    children.sort((left, right) => left.localeCompare(right));
  }

  const cycle = findCycle(nodes.map(node => node.key), parentKeysByNode);
  if (cycle) {
    throw new GraphValidationError(
      "CIRCULAR_DEPENDENCY",
      `Circular dependency detected: ${cycle.join(" -> ")}`
    );
  }

  const getNodesByKeys = (keys: readonly string[] | undefined): readonly AnyNodeDefinition[] =>
    Object.freeze(
      (keys ?? []).flatMap(key => {
        const node = nodesByKey.get(key);
        return node ? [node] : [];
      })
    );

  return Object.freeze({
    getNode: (key: string) => nodesByKey.get(key),
    hasNode: (key: string) => nodesByKey.has(key),
    getParents: (nodeOrKey: NodeOrKey) =>
      getNodesByKeys(parentKeysByNode.get(keyOf(nodeOrKey))),
    getChildren: (nodeOrKey: NodeOrKey) =>
      getNodesByKeys(childKeysByNode.get(keyOf(nodeOrKey))),
    getNodes: () => Object.freeze([...nodes]),
  });
};
