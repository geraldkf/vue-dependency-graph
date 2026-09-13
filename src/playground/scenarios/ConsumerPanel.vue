<template>
  <div :aria-label="`Consumer ${label}`">
    <h3>Consumer {{ label }}</h3>
    <p :data-testid="`status-${label}`">Status: {{ resource.status.value }}</p>
    <p :data-testid="`data-${label}`">Data: {{ resource.data.value || "(none yet)" }}</p>
  </div>
</template>

<script setup lang="ts">
// Deliberately no node prop — this component always subscribes to the
// same shared node. Two mounted instances of it, each running its own
// setup() and its own useNode() call, is what demonstrates "independent
// components sharing one node" — a node-as-prop version would only prove
// the same thing with more ceremony.
import { useNode } from "../../vue";
import { sharedResource } from "./concurrent-consumers-nodes";

defineProps<{ label: string }>();

const resource = useNode(sharedResource);
</script>
