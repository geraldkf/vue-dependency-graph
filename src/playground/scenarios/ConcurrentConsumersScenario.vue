<template>
  <section aria-label="Concurrent consumers scenario">
    <h2>Concurrent Consumers</h2>
    <p data-testid="call-count">
      Load calls so far: {{ sharedResourceLoader.callCount.value }}
    </p>
    <div style="display: flex; gap: 1rem">
      <ConsumerPanel label="A" />
      <ConsumerPanel label="B" />
    </div>
  </section>
</template>

<script setup lang="ts">
import ConsumerPanel from "./ConsumerPanel.vue";
import { sharedResourceLoader } from "./concurrent-consumers-nodes";
</script>
