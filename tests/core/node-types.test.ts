import {
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  whenEvent,
  type EventPayload,
  type NodeValue,
} from "../../src/core";

const currentProductId = defineContextNode({ key: "currentProductId", initialValue: "prod-1" });
const currentCurrency = defineContextNode({ key: "currentCurrency", initialValue: "USD" });
// Same value type (string) as currentProductId and currentCurrency, but a
// distinct node - not declared as a dependency below. Proves `get` rejects
// an undeclared node even when its value type is identical to a declared
// one, since each node's key carries its own literal type.
const otherProductId = defineContextNode({ key: "otherProductId", initialValue: "prod-2" });

const productDetails = defineDataNode({
  key: "productDetails",
  dependencies: [currentProductId, currentCurrency],
  initialValue: "",
  load: async ({ get }) => {
    const productId: string = get(currentProductId);
    const currency: string = get(currentCurrency);
    // @ts-expect-error otherProductId is not a declared dependency, even
    // though it has the exact same value type as currentProductId
    get(otherProductId);
    return `${productId}:${currency}`;
  },
});

// Prefixed with `_`: only exercised via `typeof _derived` below for the
// static NodeValue<> type check, not read as a runtime value.
const _derived = defineDerivedNode({
  key: "derived",
  dependencies: [currentProductId, productDetails],
  derive: ({ get }) => {
    const productId: string = get(currentProductId);
    const details: string = get(productDetails);
    return `${details}:${productId}`;
  },
});

const contextValue: NodeValue<typeof currentProductId> = "prod-1";
const dataValue: NodeValue<typeof productDetails> = "value";
const derivedValue: NodeValue<typeof _derived> = "value";
void [contextValue, dataValue, derivedValue];

void defineDataNode<number>({
  key: "invalid-data",
  initialValue: 0,
  // @ts-expect-error data loader must return the declared number value
  load: async () => "wrong",
});

void defineDerivedNode<number, readonly [typeof currentProductId]>({
  key: "invalid-derived",
  dependencies: [currentProductId],
  // @ts-expect-error explicit derived value type must match the derive result
  derive: () => "wrong",
});

const stockChanged = defineEvent<{
  productId: string;
  inStock: boolean;
}>("stock.changed");

type StockChangedPayload = EventPayload<typeof stockChanged>;
const stockPayload: StockChangedPayload = {
  productId: "prod-1",
  inStock: false,
};
void stockPayload;

const eventInvalidatedData = defineDataNode({
  key: "event-invalidated-data",
  dependencies: [currentProductId],
  invalidatedBy: [
    stockChanged,
    whenEvent(stockChanged, [currentProductId], ({ payload, get }) => {
      const inStock: boolean = payload.inStock;
      const productId: string = get(currentProductId);
      // @ts-expect-error whenEvent's get accepts only the dependencies
      // passed as its second argument, not the node's full dependency list
      get(otherProductId);
      return payload.productId === productId && inStock;
    }),
  ],
  initialValue: "",
  load: async () => "value",
});

const eventInvalidatedDerived = defineDerivedNode({
  key: "event-invalidated-derived",
  dependencies: [eventInvalidatedData],
  invalidatedBy: [stockChanged],
  derive: ({ get }) => get(eventInvalidatedData),
});

void [eventInvalidatedData, eventInvalidatedDerived];

const invalidStockPayload: StockChangedPayload = {
  productId: "prod-1",
  // @ts-expect-error event payload fields retain their declared types
  inStock: "invalid",
};
void invalidStockPayload;

defineContextNode({
  key: "invalid-event-context",
  initialValue: 1,
  // @ts-expect-error context nodes do not support event invalidation declarations
  invalidatedBy: [stockChanged],
});
