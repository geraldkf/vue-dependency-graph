import type { RuntimeDiagnosticEmitter } from "../diagnostics/diagnostic-emitter";
import type { GraphExecutionReason } from "../diagnostics/types";
import {
  abortAttempt,
  beginAttempt,
  failAttempt,
  succeedAttempt,
} from "../state/transitions";
import type { ExecutionConcurrencyLimiter } from "./concurrency-limiter";
import {
  GraphExecutionError,
  type NodeAttemptOutcome,
  type NodeExecutionFailure,
  isAbortError,
  toError,
} from "./types";
import type {
  ActiveAttempt,
  ExecutionOrigin,
  NodeStateRecord,
} from "../state/state";
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
  Graph,
  NodeValue,
} from "../graph/types";

export interface ExecutionDiagnosticContext {
  readonly operationId: string;
  readonly reason: GraphExecutionReason;
  readonly causeId?: string;
}

export interface RuntimeExecutionController {
  readonly execute: (
    targets: readonly AnyNodeDefinition[],
    origin: ExecutionOrigin,
    diagnostics?: ExecutionDiagnosticContext,
  ) => Promise<void>;
  readonly needsExecution: (node: AnyNodeDefinition) => boolean;
}

export interface RuntimeExecutionDependencies {
  readonly graph: Graph;
  readonly concurrencyLimiter: ExecutionConcurrencyLimiter;
  readonly getNodeState: (key: string) => NodeStateRecord;
  readonly getActiveAttempt: (key: string) => ActiveAttempt | undefined;
  readonly setActiveAttempt: (key: string, attempt: ActiveAttempt) => void;
  readonly deleteActiveAttempt: (key: string, token: symbol) => void;
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition
  ) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly onChangedRefreshResult: (
    node: AnyNodeDefinition,
    diagnostics?: ExecutionDiagnosticContext,
  ) => void;
  readonly diagnostics: RuntimeDiagnosticEmitter;
}

// Module-private sentinels used only inside `runInternal` below, to keep
// the delicate load/derive staleness-and-abort logic exactly as it was.
// Unlike before, neither type crosses `executeNode`'s boundary: the outer
// wrapper translates both into a resolved `NodeAttemptOutcome`, so nothing
// outside this one function needs an `instanceof` check to interpret an
// execution result.
class NodeAttemptFailure extends Error {
  public constructor(
    public readonly nodeKey: string,
    public readonly causeError: Error
  ) {
    super(`Node "${nodeKey}" failed.`);
    this.name = "NodeAttemptFailure";
  }
}

class ObsoleteAttempt extends Error {
  public constructor() {
    super("Execution attempt was aborted or superseded.");
    this.name = "ObsoleteAttempt";
  }
}

const isDataNode = (
  node: AnyNodeDefinition
): node is DataNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "data";

const isDerivedNode = (
  node: AnyNodeDefinition
): node is DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]> =>
  node.kind === "derived";

const hasFreshSuccessfulValue = (
  state: NodeStateRecord
): boolean =>
  state.hasSuccessfulValue &&
  state.status === "success" &&
  state.freshness === "fresh";

export const createRuntimeExecutionController = ({
  graph,
  concurrencyLimiter,
  getNodeState,
  getActiveAttempt,
  setActiveAttempt,
  deleteActiveAttempt,
  resolveRegisteredNode,
  notify,
  onChangedRefreshResult,
  diagnostics,
}: RuntimeExecutionDependencies): RuntimeExecutionController => {
  const getDependencyValue = <TNode extends AnyNodeDefinition>(
    dependency: TNode
  ): NodeValue<TNode> => {
    const state = getNodeState(dependency.key);
    if (!state.hasSuccessfulValue || state.freshness !== "fresh") {
      throw new Error(
        `Dependency "${dependency.key}" does not have a successful fresh value.`
      );
    }
    return state.data as NodeValue<TNode>;
  };

  const emitExecution = (
    type:
      | "node.execution.skipped"
      | "node.execution.reused"
      | "node.load.queued"
      | "node.load.started"
      | "node.load.succeeded"
      | "node.load.failed"
      | "node.load.aborted"
      | "node.load.discarded"
      | "node.derive.started"
      | "node.derive.succeeded"
      | "node.derive.failed",
    node: AnyNodeDefinition,
    generation: number,
    origin: ExecutionOrigin,
    context: ExecutionDiagnosticContext | undefined,
    extras: {
      readonly durationMs?: number;
      readonly error?: Error;
    } = {},
  ): void => {
    if (!context) return;
    diagnostics.emit({
      type,
      operationId: context.operationId,
      ...(context.causeId === undefined ? {} : { causeId: context.causeId }),
      nodeKey: node.key,
      nodeKind: node.kind,
      generation,
      origin,
      reason: context.reason,
      ...(extras.durationMs === undefined ? {} : { durationMs: extras.durationMs }),
      ...(extras.error === undefined ? {} : { error: diagnostics.toError(extras.error) }),
    });
  };

  const executeNode = (
    node: AnyNodeDefinition,
    origin: ExecutionOrigin,
    context: ExecutionDiagnosticContext | undefined,
  ): Promise<NodeAttemptOutcome> => {
    const state = getNodeState(node.key);
    if (hasFreshSuccessfulValue(state)) {
      emitExecution("node.execution.skipped", node, state.generation, origin, context);
      return Promise.resolve({ status: "ok" });
    }

    const active = getActiveAttempt(node.key);
    if (active?.generation === state.generation) {
      active.origins.add(origin);
      emitExecution("node.execution.reused", node, state.generation, origin, context);
      return active.promise;
    }

    if (node.kind === "context") return Promise.resolve({ status: "ok" });

    const generation = state.generation;
    const previousData = state.data;
    const hadSuccessfulValue = state.hasSuccessfulValue;
    const token = Symbol(node.key);
    const controller = new AbortController();
    const startedAt = diagnostics.now();
    const startedType = isDataNode(node) ? "node.load.started" : "node.derive.started";

    beginAttempt(state);
    notify();

    // Unchanged from before the Result-type migration: still throws
    // ObsoleteAttempt/NodeAttemptFailure internally. Only `run` below,
    // which wraps this, changed - it translates those throws into a
    // resolved outcome instead of letting the promise reject.
    const runInternal = async (): Promise<void> => {
      try {
        let value: unknown;
        if (isDataNode(node)) {
          await concurrencyLimiter.acquire(controller.signal, () =>
            emitExecution("node.load.queued", node, generation, origin, context)
          );
          emitExecution(startedType, node, generation, origin, context);
          try {
            value = await node.load({
              get: getDependencyValue,
              signal: controller.signal,
            });
          } finally {
            concurrencyLimiter.release();
          }
        } else if (isDerivedNode(node)) {
          emitExecution(startedType, node, generation, origin, context);
          value = node.derive({ get: getDependencyValue });
        } else {
          return;
        }

        const current = getNodeState(node.key);
        const currentAttempt = getActiveAttempt(node.key);
        if (
          current.generation !== generation ||
          currentAttempt?.token !== token ||
          controller.signal.aborted
        ) {
          throw new ObsoleteAttempt();
        }

        succeedAttempt(current, value);
        notify();
        emitExecution(
          isDataNode(node) ? "node.load.succeeded" : "node.derive.succeeded",
          node,
          generation,
          origin,
          context,
          { durationMs: diagnostics.now() - startedAt },
        );

        if (
          (currentAttempt.origins.has("refresh") ||
            currentAttempt.origins.has("refresh-policy")) &&
          hadSuccessfulValue &&
          !Object.is(previousData, value)
        ) {
          onChangedRefreshResult(node, context);
        }
      } catch (thrown) {
        const current = getNodeState(node.key);
        const currentAttempt = getActiveAttempt(node.key);
        const discarded =
          thrown instanceof ObsoleteAttempt ||
          current.generation !== generation ||
          currentAttempt?.token !== token;
        const aborted =
          !discarded &&
          (controller.signal.aborted || isAbortError(thrown));

        if (aborted || discarded) {
          // If nothing superseded the node while this attempt ran, it still
          // owns the state `beginAttempt` set: put the node back to
          // not-running instead of leaving it `loading`/`refreshing` with
          // nothing in flight. A superseded attempt leaves the superseding
          // transition's state alone.
          if (
            current.generation === generation &&
            currentAttempt?.token === token
          ) {
            abortAttempt(current);
            notify();
          }
          emitExecution(
            aborted ? "node.load.aborted" : "node.load.discarded",
            node,
            generation,
            origin,
            context,
            { durationMs: diagnostics.now() - startedAt },
          );
          throw new ObsoleteAttempt();
        }

        const error = toError(thrown);
        failAttempt(current, error);
        notify();
        emitExecution(
          isDataNode(node) ? "node.load.failed" : "node.derive.failed",
          node,
          generation,
          origin,
          context,
          { durationMs: diagnostics.now() - startedAt, error },
        );
        throw new NodeAttemptFailure(node.key, error);
      } finally {
        deleteActiveAttempt(node.key, token);
      }
    };

    const run = async (): Promise<NodeAttemptOutcome> => {
      try {
        await runInternal();
        return { status: "ok" };
      } catch (error) {
        if (error instanceof ObsoleteAttempt) return { status: "obsolete" };
        if (error instanceof NodeAttemptFailure) {
          return { status: "failed", error: error.causeError };
        }
        // Not one of runInternal's own sentinels - a genuine, unexpected
        // error. Let it reject rather than miscategorise it.
        throw error;
      }
    };

    const promise = Promise.resolve().then(run);
    setActiveAttempt(node.key, {
      generation,
      token,
      controller,
      origins: new Set([origin]),
      promise,
    });
    return promise;
  };

  const execute = async (
    targets: readonly AnyNodeDefinition[],
    origin: ExecutionOrigin,
    context?: ExecutionDiagnosticContext,
  ): Promise<void> => {
    if (targets.length === 0) return;

    const failures = new Map<string, NodeExecutionFailure>();
    const requested = new Map<string, Promise<NodeAttemptOutcome>>();
    const targetKeys = new Set(targets.map((target) => target.key));

    const recordFailure = (failure: NodeExecutionFailure): void => {
      if (!failures.has(failure.nodeKey)) failures.set(failure.nodeKey, failure);
    };

    const ensureNode = (node: AnyNodeDefinition): Promise<NodeAttemptOutcome> => {
      const existing = requested.get(node.key);
      if (existing) return existing;

      const nodeContext = context
        ? {
            operationId: context.operationId,
            ...(context.causeId === undefined ? {} : { causeId: context.causeId }),
            reason: targetKeys.has(node.key) ? context.reason : "dependency" as const,
          }
        : undefined;

      const promise = (async (): Promise<NodeAttemptOutcome> => {
        const parents = graph.getParents(node);
        const parentSettlements = await Promise.allSettled(
          parents.map(parent => ensureNode(parent))
        );
        // A settlement can only reject for a genuinely unexpected error
        // (see the comment in `run` above) - expected outcomes always
        // resolve. Treat an unexpected rejection as a failure for
        // blocking purposes rather than letting it derail the traversal.
        const parentOutcomes: NodeAttemptOutcome[] = parentSettlements.map(
          settlement =>
            settlement.status === "fulfilled"
              ? settlement.value
              : { status: "failed", error: toError(settlement.reason) },
        );

        if (parentOutcomes.some(outcome => outcome.status === "obsolete")) {
          return { status: "obsolete" };
        }

        const blockedBy = parentOutcomes.flatMap((outcome, index) =>
          outcome.status === "failed"
            ? [parents[index]?.key].filter(
                (key): key is string => key !== undefined
              )
            : []
        );

        if (blockedBy.length > 0) {
          recordFailure({ nodeKey: node.key, kind: "blocked", blockedBy });
          if (nodeContext) {
            diagnostics.emit({
              type: "node.execution.blocked",
              operationId: nodeContext.operationId,
              ...(nodeContext.causeId === undefined
                ? {}
                : { causeId: nodeContext.causeId }),
              nodeKey: node.key,
              nodeKind: node.kind,
              generation: getNodeState(node.key).generation,
              origin,
              reason: nodeContext.reason,
              blockedBy,
            });
          }
          return {
            status: "failed",
            error: new Error(
              `Node "${node.key}" was blocked by: ${blockedBy.join(", ")}.`
            ),
          };
        }

        const outcome = await executeNode(node, origin, nodeContext);
        if (outcome.status === "failed") {
          recordFailure({ nodeKey: node.key, kind: "failed", error: outcome.error });
        }
        return outcome;
      })();

      requested.set(node.key, promise);
      return promise;
    };

    const registeredTargets = targets.map(resolveRegisteredNode);
    await Promise.allSettled(registeredTargets.map(target => ensureNode(target)));

    if (failures.size > 0) {
      throw new GraphExecutionError([...failures.values()]);
    }
  };

  const needsExecution = (node: AnyNodeDefinition): boolean =>
    !hasFreshSuccessfulValue(getNodeState(node.key));

  return Object.freeze({ execute, needsExecution });
};
