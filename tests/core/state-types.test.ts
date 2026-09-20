import { createGraph, defineDataNode } from "../../src/core";
import { createRuntimeStateStore } from "../../src/core/state/state";
import { invalidate } from "../../src/core/state/transitions";

// Compile-time rule: outside `state/transitions.ts`, a node's runtime state is
// read-only. Like the other `*.test.ts` type tests, this file is checked by
// `tsc` (see `pnpm typecheck`), not run by Vitest.

const node = defineDataNode({
  key: "node",
  initialValue: 0,
  load: async () => 1,
});
const store = createRuntimeStateStore(createGraph({ nodes: [node] }));
const state = store.getNodeState("node");

// Reads are unrestricted.
const readData: unknown = state.data;
const readStatus: "idle" | "loading" | "refreshing" | "success" | "error" =
  state.status;
const readFreshness: "fresh" | "stale" = state.freshness;
const readError: Error | null = state.error;
const readGeneration: number = state.generation;
const readHasValue: boolean = state.hasSuccessfulValue;
void [readData, readStatus, readFreshness, readError, readGeneration, readHasValue];

// Every field is rejected as an assignment target.
// @ts-expect-error node state is written only through state/transitions.ts
state.data = 1;
// @ts-expect-error node state is written only through state/transitions.ts
state.status = "success";
// @ts-expect-error node state is written only through state/transitions.ts
state.freshness = "fresh";
// @ts-expect-error node state is written only through state/transitions.ts
state.error = new Error("direct write");
// @ts-expect-error node state is written only through state/transitions.ts
state.generation = 1;
// @ts-expect-error node state is written only through state/transitions.ts
state.hasSuccessfulValue = true;

// Compound assignment and increment are rejected too.
// @ts-expect-error the generation is advanced only by the transitions
state.generation += 1;
// @ts-expect-error the generation is advanced only by the transitions
state.generation++;

// The transitions are the way to change state, and accept the read-only record.
invalidate(state);
