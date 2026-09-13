<template>
  <section aria-label="Concurrency limit scenario">
    <h2>Concurrency Limit</h2>
    <p>
      Start four independent data loads and complete them manually to observe
      runtime-wide FIFO admission.
    </p>

    <label>
      Maximum concurrent loads
      <select
        v-model="selectedLimit"
        aria-label="Maximum concurrent loads"
        @change="reset"
      >
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="unlimited">Unlimited</option>
      </select>
    </label>

    <div>
      <button :disabled="hasRun" @click="runAll">Run all</button>
      <button :disabled="activeCount === 0" @click="completeNext">
        Complete next
      </button>
      <button :disabled="activeCount === 0" @click="completeAll">
        Complete all
      </button>
      <button @click="reset">Reset</button>
    </div>

    <dl>
      <dt>Active loaders</dt>
      <dd data-testid="active-count">{{ activeCount }}</dd>
      <dt>Maximum observed</dt>
      <dd data-testid="maximum-observed">{{ maximumObserved }}</dd>
      <dt>Start order</dt>
      <dd data-testid="start-order">{{ startOrder.join(", ") || "None" }}</dd>
    </dl>

    <ul>
      <li v-for="entry in entries" :key="entry.key">
        <strong>{{ entry.label }}</strong>:
        <span :data-testid="`loader-state-${entry.key}`">
          {{ loaderStates[entry.key] }}
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  type DataNodeDefinition,
  type GraphRuntime,
} from "../../core";

const entries = [
  { key: "first", label: "First" },
  { key: "second", label: "Second" },
  { key: "third", label: "Third" },
  { key: "fourth", label: "Fourth" },
] as const;

type EntryKey = (typeof entries)[number]["key"];
type LoaderState = "idle" | "waiting" | "running" | "completed";
type Completion = () => void;

const selectedLimit = ref<"1" | "2" | "unlimited">("2");
const hasRun = ref(false);
const activeCount = ref(0);
const maximumObserved = ref(0);
const startOrder = ref<EntryKey[]>([]);
const loaderStates = reactive<Record<EntryKey, LoaderState>>({
  first: "idle",
  second: "idle",
  third: "idle",
  fourth: "idle",
});

let completions = new Map<EntryKey, Completion>();
let runtime: GraphRuntime;
let execution: Promise<void> | undefined;
let executionSettled = true;
let nodes: readonly DataNodeDefinition<string, readonly []>[];

const configuredLimit = computed(() =>
  selectedLimit.value === "unlimited"
    ? undefined
    : Number(selectedLimit.value)
);

const createScenario = (): void => {
  const createdNodes = entries.map(({ key }) =>
    defineDataNode({
      key: `concurrency-${key}`,
      initialValue: "",
      load: async () => {
        loaderStates[key] = "running";
        activeCount.value += 1;
        maximumObserved.value = Math.max(
          maximumObserved.value,
          activeCount.value
        );
        startOrder.value.push(key);

        await new Promise<void>(resolve => {
          completions.set(key, resolve);
        });

        completions.delete(key);
        activeCount.value -= 1;
        loaderStates[key] = "completed";
        return `${key} completed`;
      },
    })
  );

  nodes = createdNodes;
  runtime = createGraphRuntime(
    createGraph({ nodes: createdNodes }),
    configuredLimit.value === undefined
      ? undefined
      : { maxConcurrentLoads: configuredLimit.value }
  );
};

const runAll = (): void => {
  hasRun.value = true;
  executionSettled = false;
  for (const { key } of entries) loaderStates[key] = "waiting";
  execution = runtime.execute(nodes).finally(() => {
    executionSettled = true;
  });
  void execution.catch(() => undefined);
};

const completeNext = (): void => {
  const next = startOrder.value.find(key => completions.has(key));
  if (next !== undefined) completions.get(next)?.();
};

const completeAll = (): void => {
  for (const complete of [...completions.values()]) complete();
};

const finishCurrentExecution = async (): Promise<void> => {
  while (!executionSettled) {
    completeAll();
    await Promise.resolve();
  }
  await execution?.catch(() => undefined);
};

const reset = async (): Promise<void> => {
  await finishCurrentExecution();
  completions = new Map();
  execution = undefined;
  hasRun.value = false;
  activeCount.value = 0;
  maximumObserved.value = 0;
  startOrder.value = [];
  for (const { key } of entries) loaderStates[key] = "idle";
  createScenario();
};

onBeforeUnmount(() => {
  void finishCurrentExecution();
});
createScenario();
</script>
