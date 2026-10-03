import { isDataNode, isDerivedNode } from "../graph/node-guards";
import type { RuntimeDiagnosticEmitter } from "../diagnostics/diagnostic-emitter";
import { GraphRuntimeShutdownError } from "../runtime-errors";
import {
  beginExecutionDiagnostics,
  emitExecution,
  type ExecutionDiagnosticContext,
} from "../diagnostics/execution-diagnostics";
import { abortAttempt, beginAttempt, failAttempt, succeedAttempt } from "../state/transitions";
import type { ExecutionConcurrencyLimiter } from "./concurrency-limiter";
import {
  GraphExecutionError,
  type NodeAttemptOutcome,
  type NodeExecutionFailure,
  isAbortError,
  toError,
} from "./types";
import type { ActiveAttempt, ExecutionOrigin, NodeStateRecord } from "../state/state";
import type { AnyNodeDefinition, Graph, NodeValue } from "../graph/types";

export type { ExecutionDiagnosticContext } from "../diagnostics/execution-diagnostics";

export interface RuntimeExecutionController {
  readonly shutdown: () => void;
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
  readonly resolveRegisteredNode: (node: AnyNodeDefinition) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly onChangedRefreshResult: (
    node: AnyNodeDefinition,
    diagnostics?: ExecutionDiagnosticContext,
  ) => void;
  readonly diagnostics: RuntimeDiagnosticEmitter;
}

const hasFreshSuccessfulValue = (state: NodeStateRecord): boolean =>
  state.hasSuccessfulValue && state.status === "success" && state.freshness === "fresh";

const createLoadAbortedError = (): Error => {
  const error = new Error("Load aborted.");
  error.name = "AbortError";
  return error;
};

/**
 * Settles with the loader's result, or - as soon as `signal` aborts - with an
 * `AbortError`, whichever comes first.
 *
 * An attempt must not stay alive just because its loader ignores the abort
 * signal: the attempt would keep its concurrency slot, its place in the active
 * attempt table, and the scheduler flush that is awaiting it, so one stalled
 * request that never checks its signal would stop every later flush in the
 * runtime. Cooperative loaders are unaffected (they reject on abort anyway).
 * For a loader that ignores the signal the runtime stops *waiting*; it cannot
 * stop the underlying work, whose eventual result or failure is ignored.
 */
const settleOrAbort = <T>(signal: AbortSignal, start: () => Promise<T> | T): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(createLoadAbortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();

    let pending: Promise<T>;
    try {
      pending = Promise.resolve(start());
    } catch (error) {
      signal.removeEventListener("abort", onAbort);
      reject(error);
      return;
    }
    // Both handlers are attached, so a loader that fails after the attempt
    // was abandoned never becomes an unhandled rejection.
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });

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
  let stopped = false;
  const getDependencyValue = <TNode extends AnyNodeDefinition>(
    dependency: TNode,
  ): NodeValue<TNode> => {
    const state = getNodeState(dependency.key);
    if (!state.hasSuccessfulValue || state.freshness !== "fresh") {
      throw new Error(`Dependency "${dependency.key}" does not have a successful fresh value.`);
    }
    return state.data as NodeValue<TNode>;
  };

  const executeNode = (
    node: AnyNodeDefinition,
    origin: ExecutionOrigin,
    context: ExecutionDiagnosticContext | undefined,
  ): Promise<NodeAttemptOutcome> => {
    if (stopped) return Promise.resolve({ status: "obsolete" });
    const state = getNodeState(node.key);
    if (hasFreshSuccessfulValue(state)) {
      emitExecution(diagnostics, "node.execution.skipped", node, state.generation, origin, context);
      return Promise.resolve({ status: "ok" });
    }

    const active = getActiveAttempt(node.key);
    if (active?.generation === state.generation) {
      active.origins.add(origin);
      emitExecution(diagnostics, "node.execution.reused", node, state.generation, origin, context);
      return active.promise;
    }

    if (node.kind === "context") return Promise.resolve({ status: "ok" });

    const generation = state.generation;
    const previousData = state.data;
    const hadSuccessfulValue = state.hasSuccessfulValue;
    const token = Symbol(node.key);
    const controller = new AbortController();
    const attemptDiagnostics = beginExecutionDiagnostics(
      diagnostics,
      node,
      generation,
      origin,
      context,
    );

    beginAttempt(state);
    notify();

    const finishObsolete = (
      current: NodeStateRecord,
      currentAttempt: ActiveAttempt | undefined,
      aborted: boolean,
    ): NodeAttemptOutcome => {
      // Only the owning attempt may restore the state it put into loading.
      if (current.generation === generation && currentAttempt?.token === token) {
        abortAttempt(current);
        notify();
      }
      attemptDiagnostics.obsolete(aborted);
      return { status: "obsolete" };
    };

    const runInternal = async (): Promise<NodeAttemptOutcome> => {
      try {
        let value: unknown;
        if (isDataNode(node)) {
          await concurrencyLimiter.acquire(controller.signal, attemptDiagnostics.queued);
          attemptDiagnostics.started();
          try {
            value = await settleOrAbort(controller.signal, () =>
              node.load({
                get: getDependencyValue,
                signal: controller.signal,
              }),
            );
          } finally {
            concurrencyLimiter.release();
          }
        } else if (isDerivedNode(node)) {
          attemptDiagnostics.started();
          value = node.derive({ get: getDependencyValue });
        } else {
          return { status: "ok" };
        }

        const current = getNodeState(node.key);
        const currentAttempt = getActiveAttempt(node.key);
        if (
          stopped ||
          current.generation !== generation ||
          currentAttempt?.token !== token ||
          controller.signal.aborted
        ) {
          return finishObsolete(current, currentAttempt, false);
        }

        succeedAttempt(current, value);
        notify();
        attemptDiagnostics.succeeded();

        if (
          (currentAttempt.origins.has("refresh") || currentAttempt.origins.has("refresh-policy")) &&
          hadSuccessfulValue &&
          !Object.is(previousData, value)
        ) {
          onChangedRefreshResult(node, context);
        }
        return { status: "ok" };
      } catch (thrown) {
        const current = getNodeState(node.key);
        const currentAttempt = getActiveAttempt(node.key);
        const discarded = current.generation !== generation || currentAttempt?.token !== token;
        const aborted = !discarded && (controller.signal.aborted || isAbortError(thrown));

        if (aborted || discarded) {
          return finishObsolete(current, currentAttempt, aborted);
        }

        const error = toError(thrown);
        failAttempt(current, error);
        notify();
        attemptDiagnostics.failed(error);
        return { status: "failed", error };
      } finally {
        deleteActiveAttempt(node.key, token);
      }
    };

    // Keep attempt settlement asynchronous before publishing it to graph traversal.
    const run = async (): Promise<NodeAttemptOutcome> => await runInternal();
    const promise = Promise.resolve().then(run);
    setActiveAttempt(node.key, {
      generation,
      token,
      controller,
      origins: new Set([origin]),
      promise,
    });
    // beginAttempt's notification can synchronously shut down the runtime.
    if (stopped) controller.abort();
    return promise;
  };

  const execute = async (
    targets: readonly AnyNodeDefinition[],
    origin: ExecutionOrigin,
    context?: ExecutionDiagnosticContext,
  ): Promise<void> => {
    if (stopped) throw new GraphRuntimeShutdownError();
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
            reason: targetKeys.has(node.key) ? context.reason : ("dependency" as const),
          }
        : undefined;

      const promise = (async (): Promise<NodeAttemptOutcome> => {
        const parents = graph.getParents(node);
        const parentSettlements = await Promise.allSettled(
          parents.map((parent) => ensureNode(parent)),
        );
        // Expected outcomes resolve. Treat an unexpected rejection as a failure for
        // blocking purposes rather than letting it derail the traversal.
        const parentOutcomes: NodeAttemptOutcome[] = parentSettlements.map((settlement) =>
          settlement.status === "fulfilled"
            ? settlement.value
            : { status: "failed", error: toError(settlement.reason) },
        );

        if (parentOutcomes.some((outcome) => outcome.status === "obsolete")) {
          return { status: "obsolete" };
        }

        const blockedBy = parentOutcomes.flatMap((outcome, index) =>
          outcome.status === "failed"
            ? [parents[index]?.key].filter((key): key is string => key !== undefined)
            : [],
        );

        if (blockedBy.length > 0) {
          recordFailure({ nodeKey: node.key, kind: "blocked", blockedBy });
          if (nodeContext) {
            diagnostics.emit({
              type: "node.execution.blocked",
              operationId: nodeContext.operationId,
              ...(nodeContext.causeId === undefined ? {} : { causeId: nodeContext.causeId }),
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
            error: new Error(`Node "${node.key}" was blocked by: ${blockedBy.join(", ")}.`),
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
    await Promise.allSettled(registeredTargets.map((target) => ensureNode(target)));
    if (stopped) throw new GraphRuntimeShutdownError();

    if (failures.size > 0) {
      throw new GraphExecutionError([...failures.values()]);
    }
  };

  const needsExecution = (node: AnyNodeDefinition): boolean =>
    !hasFreshSuccessfulValue(getNodeState(node.key));

  return Object.freeze({
    execute,
    needsExecution,
    shutdown: () => {
      stopped = true;
    },
  });
};
