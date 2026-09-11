import {
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  type NodeValue,
} from "../../src/core";

const count = defineContextNode({ key: "count", initialValue: 1 });
const label = defineContextNode({ key: "label", initialValue: "items" });
const other = defineContextNode({ key: "other", initialValue: true });

const data = defineDataNode({
  key: "data",
  dependencies: [count, label] as const,
  initialValue: "",
  load: async ({ get }) => {
    const countValue: number = get(count);
    const labelValue: string = get(label);
    // @ts-expect-error other is not a declared dependency
    get(other);
    return `${labelValue}:${countValue}`;
  },
});

const derived = defineDerivedNode({
  key: "derived",
  dependencies: [count, data] as const,
  derive: ({ get }) => {
    const countValue: number = get(count);
    const dataValue: string = get(data);
    return `${dataValue}:${countValue}`;
  },
});

const contextValue: NodeValue<typeof count> = 1;
const dataValue: NodeValue<typeof data> = "value";
const derivedValue: NodeValue<typeof derived> = "value";
void [contextValue, dataValue, derivedValue];

void defineDataNode<number>({
  key: "invalid-data",
  initialValue: 0,
  // @ts-expect-error data loader must return the declared number value
  load: async () => "wrong",
});

void defineDerivedNode<number, readonly [typeof count]>({
  key: "invalid-derived",
  dependencies: [count] as const,
  // @ts-expect-error explicit derived value type must match the derive result
  derive: () => "wrong",
});
