<template>
  <section aria-labelledby="runtime-ownership-heading">
    <h2 id="runtime-ownership-heading">Runtime Ownership</h2>
    <p>
      End this scenario's runtime while work is pending, then deliver a late response. Navigating
      away also ends the owner lifetime; returning creates a fresh runtime.
    </p>
    <button
      :disabled="stopped || requestPhase === 'pending' || mutationPhase === 'pending'"
      @click="startRequest"
    >
      Start request
    </button>
    <button :disabled="!requestResponse" @click="resolveRequest">Deliver request response</button>
    <button
      :disabled="stopped || requestPhase === 'pending' || mutationPhase === 'pending'"
      @click="startMutation"
    >
      Start mutation
    </button>
    <button :disabled="!mutationResponse" @click="resolveMutation">
      Deliver mutation response
    </button>
    <button :disabled="stopped" @click="shutdown">End owner lifetime</button>
    <p data-testid="ownership-value">Value: {{ value }}</p>
    <p data-testid="ownership-demand">Demand: {{ demand }}</p>
    <p data-testid="ownership-request">Request: {{ requestPhase }}</p>
    <p data-testid="ownership-mutation">Mutation: {{ mutationPhase }}</p>
    <p data-testid="ownership-aborted">Aborted: {{ aborted }}</p>
    <p data-testid="ownership-successes">Success callbacks: {{ successCallbacks }}</p>
    <p data-testid="ownership-error">Error: {{ errorMessage ?? "none" }}</p>
  </section>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, shallowRef } from "vue";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineMutation,
  GraphRuntimeShutdownError,
} from "../../core";

type Phase = "idle" | "pending" | "completed" | "shutdown" | "failed";
const requestPhase = ref<Phase>("idle");
const mutationPhase = ref<Phase>("idle");
const requestResponse = shallowRef<(() => void) | undefined>();
const mutationResponse = shallowRef<(() => void) | undefined>();
const stopped = ref(false);
const value = ref(0);
const demand = ref(0);
const aborted = ref(false);
const successCallbacks = ref(0);
const errorMessage = ref<string | null>(null);
let holdNextRequest = false;
let activeSignal: AbortSignal | undefined;
let requestWork: Promise<void> | undefined;
let mutationWork: Promise<void> | undefined;

const node = defineDataNode({
  key: "ownership.value",
  initialValue: 0,
  load: async ({ signal }) => {
    if (!holdNextRequest) return 1;
    holdNextRequest = false;
    activeSignal = signal;
    // Deliberately ignores cancellation to demonstrate suppression of late commits.
    return new Promise<number>((resolve) => {
      requestResponse.value = () => resolve(99);
    });
  },
});
const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
const sync = (): void => {
  value.value = runtime.getState(node).data;
  demand.value = runtime.getSubscriptionState(node).total;
  aborted.value = activeSignal?.aborted ?? false;
};
const stopWatching = runtime.onChange(sync);
runtime.subscribeNodes([node]);

const track = async (work: Promise<unknown>, phase: typeof requestPhase): Promise<void> => {
  try {
    await work;
    phase.value = "completed";
  } catch (error) {
    phase.value = error instanceof GraphRuntimeShutdownError ? "shutdown" : "failed";
    errorMessage.value = error instanceof Error ? error.name : String(error);
  } finally {
    sync();
  }
};
const startRequest = (): void => {
  holdNextRequest = true;
  requestPhase.value = "pending";
  requestWork = track(runtime.refresh([node]), requestPhase);
};
const mutation = defineMutation({
  key: "ownership.save",
  execute: ({ signal }) => {
    activeSignal = signal;
    return new Promise<number>((resolve) => {
      mutationResponse.value = () => resolve(100);
    });
  },
});
const startMutation = (): void => {
  mutationPhase.value = "pending";
  mutationWork = track(
    runtime.mutate(mutation, undefined, {
      onSuccess: (effects, result) => {
        successCallbacks.value += 1;
        effects.update(node, () => result);
      },
    }),
    mutationPhase,
  );
};
const resolveRequest = async (): Promise<void> => {
  requestResponse.value?.();
  requestResponse.value = undefined;
  await requestWork;
  sync();
};
const resolveMutation = async (): Promise<void> => {
  mutationResponse.value?.();
  mutationResponse.value = undefined;
  await mutationWork;
  sync();
};
const shutdown = (): void => {
  stopped.value = true;
  runtime.shutdown();
  sync();
};
onScopeDispose(() => {
  stopWatching();
  shutdown();
  // Observe eventual completion too, as a non-cooperative remote service could do.
  requestResponse.value?.();
  mutationResponse.value?.();
});
</script>
