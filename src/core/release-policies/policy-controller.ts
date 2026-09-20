import type { AnyNodeDefinition, DataNodeDefinition, Graph } from "../graph/types";
import type { MutableNodeRuntimeState } from "../state/state";
import type { TimerEnvironment } from "../timer-environment";

type ReleasePolicyDataNode = DataNodeDefinition<
  unknown,
  readonly AnyNodeDefinition[]
>;

interface ReleaseSession {
  timer: unknown | undefined;
  scheduledForGeneration: number | undefined;
  scheduledAt: number | undefined;
}

export interface RuntimeReleasePolicyDependencies {
  readonly graph: Graph;
  readonly environment: TimerEnvironment;
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
  readonly hasSubscribers: (node: AnyNodeDefinition) => boolean;
  /** The runtime's `releaseAfterMs` default. A node's own `release` policy,
   * when declared, always takes precedence over this - including
   * `retain()`, which opts a node out even when this default is set. */
  readonly defaultDurationMs: number | undefined;
  readonly notify: () => void;
  readonly onDiagnostic?: (nodeKey: string, idleMs: number) => void;
}

export interface RuntimeReleasePolicyController {
  /** Re-evaluates every eligible node's release timer. Called on every
   * runtime change (the same `onChange` hook the refresh-policy
   * controller uses), so a node that just lost its last subscriber, just
   * regained one, or just finished a fresh load is reconsidered
   * immediately rather than on some separate poll. */
  readonly reconcile: () => void;
  /**
   * Permanently stops the controller: clears every pending release timer and
   * turns `reconcile` into a no-op, so no idle value is released afterwards.
   * Idempotent.
   */
  readonly dispose: () => void;
}

const isReleaseEligibleDataNode = (
  node: AnyNodeDefinition
): node is ReleasePolicyDataNode =>
  node.kind === "data" && (node as ReleasePolicyDataNode).release?.kind !== "retain";

const resolveReleaseDurationMs = (
  node: ReleasePolicyDataNode,
  defaultDurationMs: number | undefined
): number | undefined => {
  const policy = node.release;
  if (policy?.kind === "release-after") return policy.durationMs;
  // `retain()` nodes are already filtered out before this is called; any
  // node reaching here either has no policy of its own (fall through to
  // the runtime default) or - defensively - an unrecognised policy kind,
  // which is treated the same as "no policy" rather than crashing the
  // reconcile loop over it.
  return defaultDurationMs;
};

export const createRuntimeReleasePolicyController = ({
  graph,
  environment,
  getMutableState,
  hasSubscribers,
  defaultDurationMs,
  notify,
  onDiagnostic,
}: RuntimeReleasePolicyDependencies): RuntimeReleasePolicyController => {
  const sessions = new Map<string, ReleaseSession>();
  let disposed = false;

  const getSession = (key: string): ReleaseSession => {
    const existing = sessions.get(key);
    if (existing) return existing;
    const created: ReleaseSession = {
      timer: undefined,
      scheduledForGeneration: undefined,
      scheduledAt: undefined,
    };
    sessions.set(key, created);
    return created;
  };

  const clearTimer = (session: ReleaseSession): void => {
    if (session.timer !== undefined) environment.clearTimeout(session.timer);
    session.timer = undefined;
    session.scheduledForGeneration = undefined;
    session.scheduledAt = undefined;
  };

  const fireRelease = (
    node: ReleasePolicyDataNode,
    session: ReleaseSession,
    scheduledForGeneration: number,
    scheduledAt: number
  ): void => {
    session.timer = undefined;
    if (disposed) return;
    const state = getMutableState(node.key);
    // Defensive re-check: reconcile() should already have cancelled this
    // timer if a subscriber returned or the value changed generation in
    // the meantime, but the check is cheap and removes any dependency on
    // reconcile always running first.
    if (
      hasSubscribers(node) ||
      state.generation !== scheduledForGeneration ||
      !state.hasSuccessfulValue
    ) {
      return;
    }

    state.data = node.initialValue;
    state.hasSuccessfulValue = false;
    state.status = "idle";
    state.freshness = "stale";
    state.error = null;
    state.generation += 1;
    notify();
    onDiagnostic?.(node.key, environment.now() - scheduledAt);
  };

  const reconcileNode = (node: ReleasePolicyDataNode): void => {
    if (disposed) return;
    const durationMs = resolveReleaseDurationMs(node, defaultDurationMs);
    const session = getSession(node.key);

    if (durationMs === undefined) {
      clearTimer(session);
      return;
    }

    const state = getMutableState(node.key);
    if (hasSubscribers(node) || !state.hasSuccessfulValue) {
      clearTimer(session);
      return;
    }

    if (
      session.timer !== undefined &&
      session.scheduledForGeneration === state.generation
    ) {
      return; // Already scheduled for this exact value - nothing changed.
    }

    clearTimer(session); // Was scheduled for a now-stale generation, if at all.
    const scheduledForGeneration = state.generation;
    const scheduledAt = environment.now();
    session.scheduledForGeneration = scheduledForGeneration;
    session.scheduledAt = scheduledAt;
    session.timer = environment.setTimeout(() => {
      fireRelease(node, session, scheduledForGeneration, scheduledAt);
    }, durationMs);
  };

  const eligibleNodes = graph.getNodes().filter(isReleaseEligibleDataNode);
  const reconcile = (): void => {
    for (const node of eligibleNodes) reconcileNode(node);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const session of sessions.values()) clearTimer(session);
  };

  return Object.freeze({ reconcile, dispose });
};
