import type { AnyNodeDefinition, GraphRuntime, NodeRuntimeState } from "../../src/core";

/**
 * Rules every node state must satisfy whenever a listener can observe it.
 * They describe what `status`, `freshness`, `error` and `hasSuccessfulValue`
 * mean together; a violation is a state no transition should ever expose.
 */
export const stateInvariantViolations = (state: NodeRuntimeState<unknown>): readonly string[] => {
  const violations: string[] = [];
  if (state.status === "error" && state.error === null) {
    violations.push("status is error but there is no error");
  }
  if (state.status !== "error" && state.error !== null) {
    violations.push(`status is ${state.status} but an error is exposed`);
  }
  if (
    (state.status === "loading" || state.status === "refreshing") &&
    state.freshness !== "stale"
  ) {
    violations.push(`status is ${state.status} but freshness is fresh`);
  }
  if (state.status === "refreshing" && !state.hasSuccessfulValue) {
    violations.push("status is refreshing but there is no successful value");
  }
  if ((state.status === "loading" || state.status === "idle") && state.hasSuccessfulValue) {
    violations.push(`status is ${state.status} but there is a successful value`);
  }
  if (state.status === "success" && !state.hasSuccessfulValue) {
    violations.push("status is success but there is no successful value");
  }
  if (state.freshness === "fresh" && (state.status !== "success" || !state.hasSuccessfulValue)) {
    violations.push("freshness is fresh without a successful value");
  }
  return violations;
};

const describeState = (state: NodeRuntimeState<unknown>): string =>
  `${state.status}/${state.freshness} gen=${state.generation} ` +
  `value=${state.hasSuccessfulValue} ` +
  `error=${state.error ? state.error.message : "-"} ` +
  `data=${String(JSON.stringify(state.data))}`;

/**
 * Records every change to any watched node's state, per change notification,
 * labelled with the current step, and checks the invariants above on every
 * notification. Only changed nodes are recorded, so the trace stays compact.
 */
export const createStateTracer = (runtime: GraphRuntime, nodes: readonly AnyNodeDefinition[]) => {
  let step = "init";
  const lines: string[] = [];
  const violations: string[] = [];
  const last = new Map<string, string>();
  const lastGeneration = new Map<string, number>();

  for (const node of nodes) {
    const state = runtime.getState(node);
    last.set(node.key, describeState(state));
    lastGeneration.set(node.key, state.generation);
  }

  runtime.onChange(() => {
    for (const node of nodes) {
      const state = runtime.getState(node);
      for (const violation of stateInvariantViolations(state)) {
        violations.push(`[${step}] ${node.key}: ${violation}`);
      }
      if (state.generation < (lastGeneration.get(node.key) ?? 0)) {
        violations.push(`[${step}] ${node.key}: generation went backwards`);
      }
      lastGeneration.set(node.key, state.generation);

      const description = describeState(state);
      if (last.get(node.key) !== description) {
        lines.push(`[${step}] ${node.key}: ${description}`);
        last.set(node.key, description);
      }
    }
  });

  return {
    setStep: (name: string): void => {
      step = name;
    },
    lines,
    violations,
  };
};
