<template>
  <section aria-labelledby="atomic-transaction-heading">
    <h2 id="atomic-transaction-heading">Atomic Transaction</h2>
    <p>
      Stage two related context values across an awaited gap. Committed reads
      and observers remain unchanged until the transaction completes.
    </p>

    <p data-testid="transaction-state">
      Transaction: {{ transactionState }}
    </p>
    <p data-testid="committed-values">
      Committed values: {{ firstState.data.value }} + {{ secondState.data.value }}
    </p>
    <p data-testid="combined-value">
      Combined result: {{ combinedState.data.value }}
    </p>
    <p data-testid="derive-count">
      Derivation count: {{ deriveCount }}
    </p>

    <p>
      <button :disabled="transactionState === 'open'" @click="startTransaction">
        Start transaction
      </button>
      <button :disabled="transactionState !== 'open'" @click="completeTransaction">
        Complete transaction
      </button>
      <button :disabled="transactionState === 'open'" @click="resetScenario">
        Reset
      </button>
    </p>

    <h3>Observer snapshots</h3>
    <ol data-testid="observer-snapshots">
      <li v-for="snapshot in snapshots" :key="snapshot">
        {{ snapshot }}
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDerivedNode,
} from "../../core";
import { useNode } from "../../vue";

const firstValue = defineContextNode({
  key: "atomic-transaction-first",
  initialValue: 1,
});
const secondValue = defineContextNode({
  key: "atomic-transaction-second",
  initialValue: 10,
});

const deriveCount = ref(0);
const combinedValue = defineDerivedNode({
  key: "atomic-transaction-combined",
  dependencies: [firstValue, secondValue] as const,
  derive: ({ get }) => {
    deriveCount.value += 1;
    return get(firstValue) + get(secondValue);
  },
});

const runtime = createGraphRuntime(
  createGraph({ nodes: [combinedValue, firstValue, secondValue] })
);
const firstState = useNode(firstValue, { runtime });
const secondState = useNode(secondValue, { runtime });
const combinedState = useNode(combinedValue, { runtime });
const transactionState = ref<"idle" | "open" | "committed">("idle");
const snapshots = ref<string[]>([]);
let releaseTransaction: (() => void) | undefined;

const unsubscribe = runtime.onChange(() => {
  snapshots.value.push(
    `${runtime.getState(firstValue).data} + ${runtime.getState(secondValue).data}`
  );
});

const startTransaction = (): void => {
  transactionState.value = "open";
  void runtime.transaction(async () => {
    runtime.setContext(firstValue, 2);
    await new Promise<void>(resolve => {
      releaseTransaction = resolve;
    });
    runtime.setContext(secondValue, 20);
  }).then(() => {
    transactionState.value = "committed";
    releaseTransaction = undefined;
  });
};

const completeTransaction = (): void => {
  releaseTransaction?.();
};

const resetScenario = (): void => {
  runtime.setContext(firstValue, 1);
  runtime.setContext(secondValue, 10);
  snapshots.value = [];
  deriveCount.value = 0;
  transactionState.value = "idle";
};

onBeforeUnmount(() => {
  releaseTransaction?.();
  unsubscribe();
});
</script>
