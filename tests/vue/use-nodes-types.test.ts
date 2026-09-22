import { defineContextNode, defineDataNode, type NodeValue } from "../../src/core";
import { useNodes } from "../../src/vue/use-nodes";

// This file is a type-only check (see tests/core/*-types.test.ts for the
// established convention): validated by `vue-tsc --noEmit`, never executed
// by vitest — calling useNodes below outside an active effect scope would
// throw at runtime, but this file never runs as JS, only as a type check.

const count = defineContextNode({ key: "types-count", initialValue: 1 });
const label = defineDataNode({
  key: "types-label",
  dependencies: [count] as const,
  initialValue: "",
  load: async ({ get }) => String(get(count)),
});

// No `as const` needed at this call site — that's the point of the
// `const` type parameter on useNodes, the same mechanism defineDataNode's
// `dependencies` already relies on.
const { results } = useNodes([count, label]);

// Each result keeps its own node's specific type rather than collapsing
// into a union of every node's possible data type.
const countValue: number = results[0].value.data;
const labelValue: string = results[1].value.data;
void [countValue, labelValue];

const countNodeValue: NodeValue<typeof count> = results[0].value.data;
void countNodeValue;

// @ts-expect-error results[0] is the context node's number data, not a string
const wrongType: string = results[0].value.data;
void wrongType;

// @ts-expect-error results[1] is the data node's string data, not a number
const alsoWrongType: number = results[1].value.data;
void alsoWrongType;
