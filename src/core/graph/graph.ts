import { GraphValidationError } from "./errors";
import { assertValidRefreshPolicy } from "../refresh-policies/policy";
import { assertValidReleasePolicy } from "../release-policies/policy";
import {
  registerEventInvalidationIndex,
  type EventInvalidationCandidate,
} from "../events/event-index";
import type { AnyEventDefinition } from "../events/types";
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
  Graph,
  NodeOrKey,
} from "./types";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

// `AnyNodeDefinition` only carries the fields common to every node kind;
// `refresh` and `invalidatedBy` live on the kind-specific interfaces. These
// guards (mirroring execution.ts's `isDataNode`/`isDerivedNode`) narrow to
// those interfaces so the fields can be read without a cast.
const isDataNode = (
  node: AnyNodeDefinition,
): node is DataNodeDefinition<unknown, readonly AnyNodeDefinition[]> => node.kind === "data";

const isDerivedNode = (
  node: AnyNodeDefinition,
): node is DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]> => node.kind === "derived";

const readEventInvalidation = (
  declaration: unknown,
  nodeKey: string,
): {
  readonly event: AnyEventDefinition;
  readonly when: EventInvalidationCandidate["when"];
} => {
  if (!isRecord(declaration)) {
    throw new GraphValidationError(
      "INVALID_EVENT_DECLARATION",
      `Node "${nodeKey}" has an invalid event invalidation declaration.`,
    );
  }

  const conditional = "event" in declaration;
  const eventValue = conditional ? declaration.event : declaration;
  if (!isRecord(eventValue) || typeof eventValue.key !== "string") {
    throw new GraphValidationError(
      "INVALID_EVENT_DECLARATION",
      `Node "${nodeKey}" has an invalid event invalidation declaration.`,
    );
  }

  if (eventValue.key.trim().length === 0) {
    throw new GraphValidationError(
      "INVALID_EVENT_KEY",
      `Node "${nodeKey}" declares an event with a blank key.`,
    );
  }

  if (conditional && typeof declaration.when !== "function") {
    throw new GraphValidationError(
      "INVALID_EVENT_DECLARATION",
      `Node "${nodeKey}" has an invalid conditional declaration for event "${eventValue.key}".`,
    );
  }

  return {
    event: eventValue as unknown as AnyEventDefinition,
    when: conditional ? (declaration.when as EventInvalidationCandidate["when"]) : undefined,
  };
};

const validateRefreshPolicy = (node: AnyNodeDefinition): void => {
  if (isDataNode(node)) {
    if (node.refresh === undefined) return;
    try {
      assertValidRefreshPolicy(node.refresh, node.key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new GraphValidationError(
        "INVALID_REFRESH_POLICY",
        `Node "${node.key}" has an invalid refresh policy: ${reason}`,
      );
    }
    return;
  }

  // Non-data nodes have no `refresh` field in the type, but graph
  // definitions can be constructed outside TypeScript, so this guards
  // against a stray refresh policy on a context/derived node. `in` needs
  // no cast - it's a safe check on any object, typed or not.
  if ("refresh" in node) {
    throw new GraphValidationError(
      "INVALID_REFRESH_POLICY",
      `Node "${node.key}" cannot declare a refresh policy because it is not a data node.`,
    );
  }
};

const validateReleasePolicy = (node: AnyNodeDefinition): void => {
  if (isDataNode(node)) {
    if (node.release === undefined) return;
    try {
      assertValidReleasePolicy(node.release, node.key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new GraphValidationError(
        "INVALID_RELEASE_POLICY",
        `Node "${node.key}" has an invalid release policy: ${reason}`,
      );
    }
    return;
  }

  // Same defensive reasoning as `validateRefreshPolicy` above: non-data
  // nodes have no `release` field in the type, but untyped input can
  // still carry one.
  if ("release" in node) {
    throw new GraphValidationError(
      "INVALID_RELEASE_POLICY",
      `Node "${node.key}" cannot declare a release policy because it is not a data node.`,
    );
  }
};

const buildEventInvalidationIndex = (
  nodes: readonly AnyNodeDefinition[],
): ReadonlyMap<string, readonly EventInvalidationCandidate[]> => {
  const candidatesByEvent = new Map<string, EventInvalidationCandidate[]>();

  for (const node of nodes) {
    // Data/derived nodes: read through the guard, no cast needed. Other
    // kinds (context) have no `invalidatedBy` in the type at all, but - as
    // with `refresh` above - untyped input can still carry one, and that
    // must still be caught below rather than silently ignored, so this
    // falls back to a narrow, explained cast for that case only.
    const invalidatedBy =
      isDataNode(node) || isDerivedNode(node)
        ? node.invalidatedBy
        : "invalidatedBy" in node
          ? (node as AnyNodeDefinition & { readonly invalidatedBy?: unknown }).invalidatedBy
          : undefined;

    if (invalidatedBy === undefined) continue;
    if (!Array.isArray(invalidatedBy)) {
      throw new GraphValidationError(
        "INVALID_EVENT_DECLARATION",
        `Node "${node.key}" must declare invalidatedBy as an array.`,
      );
    }
    if (node.kind === "context" && invalidatedBy.length > 0) {
      throw new GraphValidationError(
        "INVALID_EVENT_DECLARATION",
        `Context node "${node.key}" cannot declare event invalidation.`,
      );
    }

    const eventKeys = new Set<string>();
    for (const declaration of invalidatedBy) {
      const { event, when } = readEventInvalidation(declaration, node.key);
      if (eventKeys.has(event.key)) {
        throw new GraphValidationError(
          "DUPLICATE_EVENT_INVALIDATION",
          `Node "${node.key}" declares event "${event.key}" more than once.`,
        );
      }
      eventKeys.add(event.key);

      const candidates = candidatesByEvent.get(event.key) ?? [];
      candidates.push(Object.freeze({ event, node, when }));
      candidatesByEvent.set(event.key, candidates);
    }
  }

  return new Map(
    [...candidatesByEvent].map(([key, candidates]) => [key, Object.freeze([...candidates])]),
  );
};

export interface CreateGraphOptions {
  readonly nodes: readonly AnyNodeDefinition[];
}

const keyOf = (nodeOrKey: NodeOrKey): string =>
  typeof nodeOrKey === "string" ? nodeOrKey : nodeOrKey.key;

const findCycle = (
  keys: readonly string[],
  parentNodesByKey: ReadonlyMap<string, readonly AnyNodeDefinition[]>,
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

    // Traversal order is by key (default code-unit sort), independent of
    // declaration and registration order, so cycle messages stay deterministic.
    const parents = (parentNodesByKey.get(key) ?? []).map((parent) => parent.key).sort();
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
      throw new GraphValidationError("DUPLICATE_NODE_KEY", `Duplicate node key "${node.key}".`);
    }
    validateRefreshPolicy(node);
    validateReleasePolicy(node);
    nodesByKey.set(node.key, node);
  }

  // Topology is computed once, here, from each node's resolved dependencies,
  // and stored as node references. Parents follow declaration order; children
  // are sorted by key. Parent and child entries always point at the node
  // *registered* under that key (identity is key-based), even if a dependency
  // list holds a different object with the same key.
  const parentNodesByKey = new Map<string, readonly AnyNodeDefinition[]>();
  const childNodesByKey = new Map<string, AnyNodeDefinition[]>();

  for (const node of nodes) {
    childNodesByKey.set(node.key, []);
  }

  for (const node of nodes) {
    const parents: AnyNodeDefinition[] = [];
    const seenDependencies = new Set<string>();

    for (const dependency of node.dependencies) {
      if (seenDependencies.has(dependency.key)) {
        throw new GraphValidationError(
          "DUPLICATE_DEPENDENCY",
          `Node "${node.key}" declares dependency "${dependency.key}" more than once.`,
        );
      }
      seenDependencies.add(dependency.key);

      const registeredDependency = nodesByKey.get(dependency.key);
      if (registeredDependency === undefined) {
        throw new GraphValidationError(
          "MISSING_DEPENDENCY",
          `Node "${node.key}" references missing dependency "${dependency.key}".`,
        );
      }

      parents.push(registeredDependency);
      childNodesByKey.get(dependency.key)?.push(node);
    }

    parentNodesByKey.set(node.key, Object.freeze(parents));
  }

  for (const children of childNodesByKey.values()) {
    children.sort((left, right) => left.key.localeCompare(right.key));
    Object.freeze(children);
  }

  const cycle = findCycle(
    nodes.map((node) => node.key),
    parentNodesByKey,
  );
  if (cycle) {
    throw new GraphValidationError(
      "CIRCULAR_DEPENDENCY",
      `Circular dependency detected: ${cycle.join(" -> ")}`,
    );
  }

  const graphNodes: readonly AnyNodeDefinition[] = Object.freeze([...nodes]);
  const noNodes: readonly AnyNodeDefinition[] = Object.freeze([]);

  const graph = Object.freeze({
    getNode: (key: string) => nodesByKey.get(key),
    hasNode: (key: string) => nodesByKey.has(key),
    getParents: (nodeOrKey: NodeOrKey): readonly AnyNodeDefinition[] =>
      parentNodesByKey.get(keyOf(nodeOrKey)) ?? noNodes,
    getChildren: (nodeOrKey: NodeOrKey): readonly AnyNodeDefinition[] =>
      childNodesByKey.get(keyOf(nodeOrKey)) ?? noNodes,
    getNodes: () => graphNodes,
  });

  registerEventInvalidationIndex(graph, buildEventInvalidationIndex(nodes));

  return graph;
};
