import type { NodeSubscription, NodeSubscriptionState } from "./types";
import type { AnyNodeDefinition, Graph } from "../graph/types";

interface MutableNodeSubscriptionState {
  direct: number;
  required: number;
}

export interface RuntimeSubscriptionController {
  readonly shutdown: () => void;
  readonly subscribeNodes: (nodes: readonly AnyNodeDefinition[]) => NodeSubscription;
  readonly getSubscriptionState: (node: AnyNodeDefinition) => NodeSubscriptionState;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  readonly hasDirectSubscribers: (node: AnyNodeDefinition) => boolean;
}

export interface RuntimeSubscriptionDependencies {
  readonly graph: Graph;
  readonly resolveRegisteredNode: (node: AnyNodeDefinition, purpose: string) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly onDemandChanged?: (keys: Iterable<string>) => void;
  readonly afterSubscribe: () => void;
  readonly afterUnsubscribe: () => void;
  readonly onAdded?: (
    directNodeKeys: readonly string[],
    requiredNodeKeys: readonly string[],
  ) => void;
  readonly onRemoved?: (
    directNodeKeys: readonly string[],
    requiredNodeKeys: readonly string[],
  ) => void;
}

export const createRuntimeSubscriptionController = ({
  graph,
  resolveRegisteredNode,
  notify,
  afterSubscribe,
  afterUnsubscribe,
  onDemandChanged,
  onAdded,
  onRemoved,
}: RuntimeSubscriptionDependencies): RuntimeSubscriptionController => {
  const subscriptionStates = new Map<string, MutableNodeSubscriptionState>();
  let stopped = false;

  for (const node of graph.getNodes()) {
    subscriptionStates.set(node.key, { direct: 0, required: 0 });
  }

  const requireSubscriptionState = (key: string): MutableNodeSubscriptionState => {
    const state = subscriptionStates.get(key);
    if (!state) {
      throw new Error(`Subscription state for node "${key}" was not found.`);
    }
    return state;
  };

  const getSubscriptionState = (node: AnyNodeDefinition): NodeSubscriptionState => {
    const registered = resolveRegisteredNode(node, "subscription inspection");
    const state = requireSubscriptionState(registered.key);
    return Object.freeze({
      direct: state.direct,
      required: state.required,
      total: state.direct + state.required,
    });
  };

  const hasSubscribers = (node: AnyNodeDefinition): boolean => getSubscriptionState(node).total > 0;

  const hasDirectSubscribers = (node: AnyNodeDefinition): boolean =>
    requireSubscriptionState(node.key).direct > 0;

  const subscribeNodes = (requestedNodes: readonly AnyNodeDefinition[]): NodeSubscription => {
    const directNodes: AnyNodeDefinition[] = [];
    const directKeys = new Set<string>();

    for (const requested of requestedNodes) {
      const registered = resolveRegisteredNode(requested, "node subscription");
      if (directKeys.has(registered.key)) continue;
      directKeys.add(registered.key);
      directNodes.push(registered);
    }

    const frozenNodes = Object.freeze([...directNodes]);
    if (directNodes.length === 0) {
      return Object.freeze({
        nodes: frozenNodes,
        unsubscribe: () => undefined,
      });
    }

    const visitedAncestors = new Set<string>();
    const requiredKeys = new Set<string>();
    const queue = directNodes.flatMap((node) => graph.getParents(node));

    while (queue.length > 0) {
      const ancestor = queue.shift();
      if (!ancestor || visitedAncestors.has(ancestor.key)) continue;
      visitedAncestors.add(ancestor.key);
      requiredKeys.add(ancestor.key);
      queue.push(...graph.getParents(ancestor));
    }

    for (const key of directKeys) requiredKeys.delete(key);
    for (const key of directKeys) {
      requireSubscriptionState(key).direct += 1;
    }
    for (const key of requiredKeys) {
      requireSubscriptionState(key).required += 1;
    }

    onDemandChanged?.(directKeys);
    onDemandChanged?.(requiredKeys);
    notify();
    onAdded?.([...directKeys], [...requiredKeys]);
    afterSubscribe();

    let active = true;
    return Object.freeze({
      nodes: frozenNodes,
      unsubscribe: () => {
        if (stopped || !active) return;

        for (const key of directKeys) {
          if (requireSubscriptionState(key).direct <= 0) {
            throw new Error(`Direct subscription for node "${key}" cannot become negative.`);
          }
        }
        for (const key of requiredKeys) {
          if (requireSubscriptionState(key).required <= 0) {
            throw new Error(`Required subscription for node "${key}" cannot become negative.`);
          }
        }

        for (const key of directKeys) {
          requireSubscriptionState(key).direct -= 1;
        }
        for (const key of requiredKeys) {
          requireSubscriptionState(key).required -= 1;
        }
        active = false;

        onDemandChanged?.(directKeys);
        onDemandChanged?.(requiredKeys);
        notify();
        onRemoved?.([...directKeys], [...requiredKeys]);
        afterUnsubscribe();
      },
    });
  };

  return Object.freeze({
    shutdown: () => {
      stopped = true;
      const direct: string[] = [];
      const required: string[] = [];
      for (const [key, state] of subscriptionStates) {
        direct.push(...Array<string>(state.direct).fill(key));
        required.push(...Array<string>(state.required).fill(key));
        state.direct = 0;
        state.required = 0;
      }
      if (direct.length || required.length) onRemoved?.(direct, required);
    },
    subscribeNodes,
    getSubscriptionState,
    hasSubscribers,
    hasDirectSubscribers,
  });
};
