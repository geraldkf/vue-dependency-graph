import { GraphValidationError } from "./errors";
import {
  registerEventInvalidationIndex,
  type EventInvalidationCandidate,
} from "../events/event-index";
import type { AnyEventDefinition } from "../events/types";
import type {
  AnyNodeDefinition,
  Graph,
  NodeOrKey,
} from "./types";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const readEventInvalidation = (
  declaration: unknown,
  nodeKey: string
): {
  readonly event: AnyEventDefinition;
  readonly when: EventInvalidationCandidate["when"];
} => {
  if (!isRecord(declaration)) {
    throw new GraphValidationError(
      "INVALID_EVENT_DECLARATION",
      `Node "${nodeKey}" has an invalid event invalidation declaration.`
    );
  }

  const conditional = "event" in declaration;
  const eventValue = conditional ? declaration.event : declaration;
  if (!isRecord(eventValue) || typeof eventValue.key !== "string") {
    throw new GraphValidationError(
      "INVALID_EVENT_DECLARATION",
      `Node "${nodeKey}" has an invalid event invalidation declaration.`
    );
  }

  if (eventValue.key.trim().length === 0) {
    throw new GraphValidationError(
      "INVALID_EVENT_KEY",
      `Node "${nodeKey}" declares an event with a blank key.`
    );
  }

  if (conditional && typeof declaration.when !== "function") {
    throw new GraphValidationError(
      "INVALID_EVENT_DECLARATION",
      `Node "${nodeKey}" has an invalid conditional declaration for event "${eventValue.key}".`
    );
  }

  return {
    event: eventValue as unknown as AnyEventDefinition,
    when: conditional
      ? declaration.when as EventInvalidationCandidate["when"]
      : undefined,
  };
};

const buildEventInvalidationIndex = (
  nodes: readonly AnyNodeDefinition[]
): ReadonlyMap<string, readonly EventInvalidationCandidate[]> => {
  const candidatesByEvent = new Map<string, EventInvalidationCandidate[]>();

  for (const node of nodes) {
    const invalidatedBy = "invalidatedBy" in node
      ? (node as AnyNodeDefinition & { readonly invalidatedBy?: unknown }).invalidatedBy
      : undefined;

    if (invalidatedBy === undefined) continue;
    if (!Array.isArray(invalidatedBy)) {
      throw new GraphValidationError(
        "INVALID_EVENT_DECLARATION",
        `Node "${node.key}" must declare invalidatedBy as an array.`
      );
    }
    if (node.kind === "context" && invalidatedBy.length > 0) {
      throw new GraphValidationError(
        "INVALID_EVENT_DECLARATION",
        `Context node "${node.key}" cannot declare event invalidation.`
      );
    }

    const eventKeys = new Set<string>();
    for (const declaration of invalidatedBy) {
      const { event, when } = readEventInvalidation(declaration, node.key);
      if (eventKeys.has(event.key)) {
        throw new GraphValidationError(
          "DUPLICATE_EVENT_INVALIDATION",
          `Node "${node.key}" declares event "${event.key}" more than once.`
        );
      }
      eventKeys.add(event.key);

      const candidates = candidatesByEvent.get(event.key) ?? [];
      candidates.push(Object.freeze({ event, node, when }));
      candidatesByEvent.set(event.key, candidates);
    }
  }

  return new Map(
    [...candidatesByEvent].map(([key, candidates]) => [
      key,
      Object.freeze([...candidates]),
    ])
  );
};

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

  const graph = Object.freeze({
    getNode: (key: string) => nodesByKey.get(key),
    hasNode: (key: string) => nodesByKey.has(key),
    getParents: (nodeOrKey: NodeOrKey) =>
      getNodesByKeys(parentKeysByNode.get(keyOf(nodeOrKey))),
    getChildren: (nodeOrKey: NodeOrKey) =>
      getNodesByKeys(childKeysByNode.get(keyOf(nodeOrKey))),
    getNodes: () => Object.freeze([...nodes]),
  });

  registerEventInvalidationIndex(
    graph,
    buildEventInvalidationIndex(nodes)
  );

  return graph;
};
