import type { AnyNodeDefinition } from "../graph/types";
import type { NodeStateRecord } from "../state/state";

export interface MutationStateSnapshot {
  readonly node: AnyNodeDefinition;
  readonly data: unknown;
  readonly status: NodeStateRecord["status"];
  readonly freshness: NodeStateRecord["freshness"];
  readonly error: Error | null;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
}

export interface OptimisticSession {
  readonly token: symbol;
  readonly targets: readonly AnyNodeDefinition[];
  readonly snapshots: readonly MutationStateSnapshot[];
  readonly expectedGenerations: ReadonlyMap<string, number>;
}

export type OptimisticSessionStart =
  | {
      readonly started: true;
      readonly session: OptimisticSession;
    }
  | {
      readonly started: false;
      readonly conflictingKeys: readonly string[];
    };

export interface OptimisticSessionManager {
  readonly begin: (
    targets: readonly AnyNodeDefinition[],
    affectedNodes: readonly AnyNodeDefinition[],
  ) => OptimisticSessionStart;
  readonly captureExpectedGenerations: (
    session: OptimisticSession,
  ) => OptimisticSession;
  readonly getRollbackConflicts: (
    session: OptimisticSession,
  ) => readonly string[];
  readonly shouldScheduleRestoredState: (
    session: OptimisticSession,
  ) => boolean;
  readonly release: (session: OptimisticSession | undefined) => void;
}

export interface OptimisticSessionManagerDependencies {
  readonly getNodeState: (key: string) => NodeStateRecord;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
}

export const createOptimisticSessionManager = ({
  getNodeState,
  hasSubscribers,
}: OptimisticSessionManagerDependencies): OptimisticSessionManager => {
  const optimisticOwners = new Map<string, symbol>();

  const snapshotNodes = (
    nodes: readonly AnyNodeDefinition[],
  ): readonly MutationStateSnapshot[] => {
    const unique = new Map(nodes.map(node => [node.key, node]));
    return Object.freeze(
      [...unique.values()].map(node => {
        const state = getNodeState(node.key);
        return Object.freeze({
          node,
          data: state.data,
          status: state.status,
          freshness: state.freshness,
          error: state.error,
          generation: state.generation,
          hasSuccessfulValue: state.hasSuccessfulValue,
        });
      }),
    );
  };

  const begin = (
    targets: readonly AnyNodeDefinition[],
    affectedNodes: readonly AnyNodeDefinition[],
  ): OptimisticSessionStart => {
    const conflictingKeys = targets
      .filter(node => optimisticOwners.has(node.key))
      .map(node => node.key);
    if (conflictingKeys.length > 0) {
      return Object.freeze({
        started: false as const,
        conflictingKeys: Object.freeze([...conflictingKeys]),
      });
    }

    const token = Symbol("optimistic-mutation");
    const frozenTargets = Object.freeze([...targets]);
    const snapshots = snapshotNodes([...targets, ...affectedNodes]);
    for (const node of frozenTargets) optimisticOwners.set(node.key, token);

    return Object.freeze({
      started: true as const,
      session: Object.freeze({
        token,
        targets: frozenTargets,
        snapshots,
        expectedGenerations: new Map<string, number>(),
      }),
    });
  };

  const captureExpectedGenerations = (
    session: OptimisticSession,
  ): OptimisticSession => Object.freeze({
    ...session,
    expectedGenerations: new Map(
      session.snapshots.map(snapshot => [
        snapshot.node.key,
        getNodeState(snapshot.node.key).generation,
      ]),
    ),
  });

  const getRollbackConflicts = (
    session: OptimisticSession,
  ): readonly string[] => {
    const conflictingKeys = new Set<string>();
    for (const target of session.targets) {
      if (optimisticOwners.get(target.key) !== session.token) {
        conflictingKeys.add(target.key);
      }
    }

    const targetKeys = new Set(session.targets.map(node => node.key));
    for (const snapshot of session.snapshots) {
      const state = getNodeState(snapshot.node.key);
      if (
        state.generation !== session.expectedGenerations.get(snapshot.node.key) ||
        (
          !targetKeys.has(snapshot.node.key) &&
          snapshot.node.kind === "data" &&
          state.status === "success" &&
          state.freshness === "fresh" &&
          !Object.is(state.data, snapshot.data)
        )
      ) {
        conflictingKeys.add(snapshot.node.key);
      }
    }

    return Object.freeze([...conflictingKeys].sort());
  };

  const shouldScheduleRestoredState = (
    session: OptimisticSession,
  ): boolean => session.snapshots.some(
    snapshot =>
      snapshot.freshness === "stale" && hasSubscribers(snapshot.node),
  );

  const release = (session: OptimisticSession | undefined): void => {
    if (!session) return;
    for (const node of session.targets) {
      if (optimisticOwners.get(node.key) === session.token) {
        optimisticOwners.delete(node.key);
      }
    }
  };

  return Object.freeze({
    begin,
    captureExpectedGenerations,
    getRollbackConflicts,
    shouldScheduleRestoredState,
    release,
  });
};
