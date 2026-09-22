<template>
  <section aria-labelledby="atomic-transaction-heading">
    <h2 id="atomic-transaction-heading">Atomic Transaction</h2>
    <p>
      Compare one transaction session's progress with committed runtime state. The runtime continues
      to expose only committed values until commit. Use Transaction Isolation to compare overlapping
      top-level sessions.
    </p>

    <p data-testid="transaction-state">Transaction: {{ transactionPhase }}</p>
    <p data-testid="transaction-outcome">Outcome: {{ transactionOutcome }}</p>
    <p v-if="transactionError" role="alert" data-testid="transaction-error">
      Error: {{ transactionError }}
    </p>

    <section aria-labelledby="committed-state-heading">
      <h3 id="committed-state-heading">Committed runtime state</h3>
      <p data-testid="committed-values">
        Values: {{ firstState.data.value }} + {{ secondState.data.value }}
      </p>
      <p data-testid="combined-value">Combined result: {{ combinedState.data.value }}</p>
      <p data-testid="derive-count">Derivation count: {{ deriveCount }}</p>
    </section>

    <section aria-labelledby="transaction-progress-heading">
      <h3 id="transaction-progress-heading">Transaction progress</h3>
      <template v-if="draft">
        <p data-testid="in-progress-values">
          In-progress values: {{ draft.first }} + {{ draft.second }}
        </p>
        <p data-testid="preview-result">Preview result: {{ previewResult }}</p>
      </template>
      <p v-else data-testid="in-progress-values">In-progress values: none</p>
    </section>

    <section aria-labelledby="unrelated-runtime-heading">
      <h3 id="unrelated-runtime-heading">Unrelated runtime activity</h3>
      <p>
        A plain runtime context write remains immediate while this transaction is paused and
        survives transaction rollback.
      </p>
      <p data-testid="unrelated-context-value">
        Unrelated context: {{ unrelatedState.data.value }}
      </p>
      <p data-testid="unrelated-dependent-value">
        Unrelated dependent result: {{ unrelatedDependentState.data.value }}
      </p>
      <p data-testid="unrelated-load-count">Unrelated load count: {{ unrelatedLoadCount }}</p>
      <p data-testid="unrelated-update-state">Unrelated update: {{ unrelatedUpdateState }}</p>
      <button
        :disabled="!isTransactionActive || unrelatedUpdateApplied || conflictWriteApplied"
        @click="applyUnrelatedRuntimeUpdate"
      >
        Apply unrelated runtime update
      </button>
    </section>

    <section aria-labelledby="transaction-conflict-heading">
      <h3 id="transaction-conflict-heading">Same-context conflict</h3>
      <p>
        Stage the first value, then update that same context directly. Commit detects the changed
        generation and preserves the immediate value.
      </p>
      <p data-testid="conflict-state">Conflict: {{ conflictState }}</p>
      <p data-testid="conflict-keys">Conflicting contexts: {{ conflictKeysText }}</p>
      <button
        :disabled="
          transactionPhase !== 'first-staged' || conflictWriteApplied || unrelatedUpdateApplied
        "
        @click="applyConflictingRuntimeUpdate"
      >
        Apply conflicting runtime update
      </button>
    </section>

    <p>
      <button :disabled="isTransactionActive" @click="startTransaction">Start transaction</button>
      <button :disabled="transactionPhase !== 'first-staged'" @click="stageSecondValue">
        Stage second value
      </button>
      <button :disabled="transactionPhase !== 'second-staged'" @click="commitTransaction">
        Commit transaction
      </button>
      <button :disabled="transactionPhase !== 'second-staged'" @click="rollbackTransaction">
        Rollback with error
      </button>
      <button :disabled="isTransactionActive" @click="resetScenario">Reset</button>
    </p>

    <h3>Committed observer snapshots</h3>
    <ol data-testid="observer-snapshots">
      <li v-for="snapshot in snapshots" :key="snapshot">
        {{ snapshot }}
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  GraphTransactionConflictError,
} from "../../core";
import { useNode } from "../../vue";

interface TransactionDraft {
  readonly first: number;
  readonly second: number;
}

type TransactionPhase =
  | "idle"
  | "first-staged"
  | "second-staged"
  | "committing"
  | "rolling-back"
  | "committed"
  | "rolled-back"
  | "conflicted";

type TransactionDecision = "commit" | "rollback";
type TransactionOutcome = "none" | "committed" | "rolled back" | "conflict rejected";

const firstValue = defineContextNode({
  key: "atomic-transaction-first",
  initialValue: 1,
});
const secondValue = defineContextNode({
  key: "atomic-transaction-second",
  initialValue: 10,
});
const unrelatedValue = defineContextNode({
  key: "atomic-transaction-unrelated",
  initialValue: 100,
});
const unrelatedLoadCount = ref(0);
const unrelatedDependent = defineDataNode({
  key: "atomic-transaction-unrelated-dependent",
  dependencies: [unrelatedValue] as const,
  initialValue: 100,
  load: async ({ get }) => {
    unrelatedLoadCount.value += 1;
    return get(unrelatedValue);
  },
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
  createGraph({
    nodes: [combinedValue, unrelatedDependent, firstValue, secondValue, unrelatedValue],
  }),
);
const firstState = useNode(firstValue, { runtime });
const secondState = useNode(secondValue, { runtime });
const combinedState = useNode(combinedValue, { runtime });
const unrelatedState = useNode(unrelatedValue, { runtime });
const unrelatedDependentState = useNode(unrelatedDependent, { runtime });
const transactionPhase = ref<TransactionPhase>("idle");
const transactionOutcome = ref<TransactionOutcome>("none");
const transactionError = ref<string | null>(null);
const draft = ref<TransactionDraft | null>(null);
const snapshots = ref<string[]>([]);
const unrelatedUpdateApplied = ref(false);
const unrelatedUpdateState = ref("not applied");
const conflictWriteApplied = ref(false);
const conflictState = ref("not demonstrated");
const conflictKeys = ref<readonly string[]>([]);
const conflictKeysText = computed(() =>
  conflictKeys.value.length > 0 ? conflictKeys.value.join(", ") : "none",
);
const previewResult = computed(() => (draft.value ? draft.value.first + draft.value.second : null));
const isTransactionActive = computed(
  () =>
    transactionPhase.value === "first-staged" ||
    transactionPhase.value === "second-staged" ||
    transactionPhase.value === "committing" ||
    transactionPhase.value === "rolling-back",
);

let releaseSecondStage: (() => void) | undefined;
let resolveDecision: ((decision: TransactionDecision) => void) | undefined;
let isMounted = true;
let lastObservedContextPair = `${runtime.getState(firstValue).data} + ${runtime.getState(secondValue).data}`;

const unsubscribe = runtime.onChange(() => {
  const contextPair = `${runtime.getState(firstValue).data} + ${runtime.getState(secondValue).data}`;
  if (contextPair === lastObservedContextPair) return;

  lastObservedContextPair = contextPair;
  snapshots.value.push(contextPair);
});

const startTransaction = (): void => {
  transactionOutcome.value = "none";
  transactionError.value = null;
  unrelatedUpdateApplied.value = false;
  unrelatedUpdateState.value = "not applied";
  conflictWriteApplied.value = false;
  conflictState.value = "not demonstrated";
  conflictKeys.value = [];

  void runtime
    .transaction(async (transaction) => {
      transaction.setContext(firstValue, 2);
      draft.value = {
        first: 2,
        second: runtime.getState(secondValue).data,
      };
      transactionPhase.value = "first-staged";

      await new Promise<void>((resolve) => {
        releaseSecondStage = resolve;
      });
      if (!isMounted) return;

      transaction.setContext(secondValue, 20);
      draft.value = { first: 2, second: 20 };
      transactionPhase.value = "second-staged";

      const decision = await new Promise<TransactionDecision>((resolve) => {
        resolveDecision = resolve;
      });
      if (decision === "rollback") {
        throw new Error("Playground transaction rollback");
      }
    })
    .then(() => {
      if (!isMounted) return;
      transactionPhase.value = "committed";
      transactionOutcome.value = "committed";
    })
    .catch((error: unknown) => {
      if (!isMounted) return;
      if (error instanceof GraphTransactionConflictError) {
        transactionPhase.value = "conflicted";
        transactionOutcome.value = "conflict rejected";
        conflictState.value = "detected; immediate value preserved";
        conflictKeys.value = error.contextKeys;
        transactionError.value = null;
        return;
      }

      transactionPhase.value = "rolled-back";
      transactionOutcome.value = "rolled back";
      transactionError.value = error instanceof Error ? error.message : "Transaction failed";
    })
    .finally(() => {
      releaseSecondStage = undefined;
      resolveDecision = undefined;
      if (isMounted) draft.value = null;
    });
};

const applyConflictingRuntimeUpdate = (): void => {
  runtime.setContext(firstValue, 999);
  conflictWriteApplied.value = true;
  conflictState.value = "immediate value committed; finish transaction to detect conflict";
};

const applyUnrelatedRuntimeUpdate = async (): Promise<void> => {
  runtime.setContext(unrelatedValue, 999);
  unrelatedUpdateApplied.value = true;
  unrelatedUpdateState.value = "committed while transaction open";
  await runtime.whenSettled();
};

const stageSecondValue = (): void => {
  releaseSecondStage?.();
  releaseSecondStage = undefined;
};

const commitTransaction = (): void => {
  transactionPhase.value = "committing";
  resolveDecision?.("commit");
  resolveDecision = undefined;
};

const rollbackTransaction = (): void => {
  transactionPhase.value = "rolling-back";
  resolveDecision?.("rollback");
  resolveDecision = undefined;
};

const resetScenario = async (): Promise<void> => {
  await runtime.transaction((transaction) => {
    transaction.setContext(firstValue, 1);
    transaction.setContext(secondValue, 10);
    transaction.setContext(unrelatedValue, 100);
  });
  await runtime.whenSettled();

  snapshots.value = [];
  lastObservedContextPair = `${runtime.getState(firstValue).data} + ${runtime.getState(secondValue).data}`;
  deriveCount.value = 0;
  unrelatedLoadCount.value = 0;
  unrelatedUpdateApplied.value = false;
  unrelatedUpdateState.value = "not applied";
  conflictWriteApplied.value = false;
  conflictState.value = "not demonstrated";
  conflictKeys.value = [];
  draft.value = null;
  transactionError.value = null;
  transactionOutcome.value = "none";
  transactionPhase.value = "idle";
};

onBeforeUnmount(() => {
  isMounted = false;
  unsubscribe();
  releaseSecondStage?.();
  resolveDecision?.("rollback");
  releaseSecondStage = undefined;
  resolveDecision = undefined;
});
</script>
