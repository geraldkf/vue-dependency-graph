<template>
  <section aria-label="Context switching scenario">
    <h2>Context Switching</h2>
    <p>
      <button
        v-for="id in userIds"
        :key="id"
        :disabled="context.data.value === id"
        @click="runtime.setContext(selectedUserId, id)"
      >
        User {{ id }}
      </button>
    </p>
    <p data-testid="status">Status: {{ profile.status.value }}</p>
    <p data-testid="data">Data: {{ profile.data.value || "(none yet)" }}</p>
  </section>
</template>

<script setup lang="ts">
// Imports from the public "../../vue" barrel, not internal src/vue files —
// this scenario exists to prove the public API works, so it should be
// written the way a real consumer of the framework would write it.
import { useNode } from "../../vue";
import { useDependencyGraphStore } from "../dependency-graph-store";
import {
  selectedUserId,
  userIds,
  userProfile,
} from "./context-switching-nodes";

const { runtime } = useDependencyGraphStore();
const context = useNode(selectedUserId, { runtime });
const profile = useNode(userProfile, { runtime });
</script>
