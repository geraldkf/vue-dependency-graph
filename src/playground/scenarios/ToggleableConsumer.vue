<template>
  <div aria-label="Toggleable consumer">
    <p data-testid="toggleable-status">Status: {{ resource.status.value }}</p>
    <p data-testid="toggleable-data">
      Data: {{ resource.data.value || "(none yet)" }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { useNode } from "../../vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import { toggleableResource } from "./unmount-cleanup-nodes";

const { runtime } = useDependencyGraphStore();
const resource = useNode(toggleableResource, { runtime });
</script>
