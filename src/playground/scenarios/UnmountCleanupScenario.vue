<template>
  <section aria-label="Unmount cleanup scenario">
    <h2>Unmount Cleanup</h2>
    <p>
      <button @click="visible = !visible">{{ visible ? "Hide" : "Show" }} consumer</button>
    </p>
    <p data-testid="subscriber-count">Subscribers: {{ subscriberCount }}</p>
    <ToggleableConsumer v-if="visible" />
  </section>
</template>

<script setup lang="ts">
// The subscriber count is deliberately made reactive here, in the
// scenario component itself, rather than exposed as part of the public
// library — getSubscriptionState() is a plain function call, not tracked
// by Vue's reactivity, so without this the count would go stale in the
// DOM until something unrelated forced a re-render. This is playground
// wiring, not something useNode/useNodes need to solve.
import { onScopeDispose, ref } from "vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import ToggleableConsumer from "./ToggleableConsumer.vue";
import { toggleableResource } from "./unmount-cleanup-nodes";

const { runtime } = useDependencyGraphStore();
const visible = ref(true);

const subscriberCount = ref(runtime.getSubscriptionState(toggleableResource).direct);
const stopWatchingSubscriberCount = runtime.onChange(() => {
  subscriberCount.value = runtime.getSubscriptionState(toggleableResource).direct;
});
onScopeDispose(stopWatchingSubscriberCount);
</script>
