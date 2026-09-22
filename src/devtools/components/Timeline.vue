<script setup lang="ts">
import { computed, ref } from "vue";
import type { InspectorTimelineCategory, InspectorTimelineEntry } from "../protocol/types";

const props = defineProps<{
  entries: readonly InspectorTimelineEntry[];
  selectedNodeKey?: string | undefined;
}>();

const emit = defineEmits<{ select: [key: string] }>();

const ALL_CATEGORIES: readonly InspectorTimelineCategory[] = [
  "operation",
  "subscription",
  "scheduler",
  "context",
  "invalidation",
  "execution",
  "event",
  "transaction",
  "refresh-policy",
  "release",
  "mutation",
];

const activeCategories = ref(new Set<InspectorTimelineCategory>(ALL_CATEGORIES));
const onlyFailures = ref(false);
const onlySelectedNode = ref(false);

const toggleCategory = (category: InspectorTimelineCategory): void => {
  const next = new Set(activeCategories.value);
  if (next.has(category)) next.delete(category);
  else next.add(category);
  activeCategories.value = next;
};

const filtered = computed(() =>
  props.entries.filter((entry) => {
    if (!activeCategories.value.has(entry.category)) return false;
    if (onlyFailures.value && !entry.isFailure) return false;
    if (onlySelectedNode.value && entry.nodeKey !== props.selectedNodeKey) return false;
    return true;
  }),
);

// Newest first - a live timeline is read top-down for "what just happened".
const displayed = computed(() => [...filtered.value].reverse());

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}.${String(date.getMilliseconds()).padStart(3, "0")}`;
};
</script>

<template>
  <div class="gdt-timeline">
    <div class="gdt-timeline-filters">
      <button
        v-for="category in ALL_CATEGORIES"
        :key="category"
        type="button"
        class="gdt-filter-chip"
        :class="{ 'gdt-filter-chip--active': activeCategories.has(category) }"
        @click="toggleCategory(category)"
      >
        {{ category }}
      </button>
      <label class="gdt-toggle">
        <input v-model="onlyFailures" type="checkbox" />
        Failures only
      </label>
      <label v-if="selectedNodeKey" class="gdt-toggle">
        <input v-model="onlySelectedNode" type="checkbox" />
        Selected node only
      </label>
    </div>

    <ol class="gdt-timeline-list" :data-testid="'gdt-timeline-list'">
      <li
        v-for="entry in displayed"
        :key="entry.sequence"
        class="gdt-timeline-entry"
        :class="{ 'gdt-timeline-entry--failure': entry.isFailure }"
      >
        <span class="gdt-timeline-time">{{ formatTime(entry.timestamp) }}</span>
        <span class="gdt-timeline-category">{{ entry.category }}</span>
        <span class="gdt-timeline-label">{{ entry.label }}</span>
        <button
          v-if="entry.nodeKey"
          type="button"
          class="gdt-timeline-node-link"
          @click="emit('select', entry.nodeKey)"
        >
          {{ entry.nodeKey }}
        </button>
      </li>
      <li v-if="displayed.length === 0" class="gdt-empty">No events match these filters.</li>
    </ol>
  </div>
</template>

<style scoped>
.gdt-timeline {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--gdt-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  color: var(--gdt-color-text, #e4edf1);
  font-size: 12px;
}

.gdt-timeline-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--gdt-color-border, #2a3640);
}

.gdt-filter-chip {
  background: none;
  border: 1px solid var(--gdt-color-border, #2a3640);
  color: var(--gdt-color-text-muted, #8ca0ac);
  border-radius: 2px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.gdt-filter-chip--active {
  color: var(--gdt-color-text, #e4edf1);
  border-color: var(--gdt-color-selected, #4fa8d8);
}

.gdt-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--gdt-color-text-muted, #8ca0ac);
  font-size: 11px;
  margin-left: 8px;
}

.gdt-timeline-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
}

.gdt-timeline-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--gdt-color-border-subtle, #1a2329);
  white-space: nowrap;
}

.gdt-timeline-entry--failure {
  background: color-mix(in srgb, var(--gdt-color-error, #e2604f) 10%, transparent);
}

.gdt-timeline-time {
  color: var(--gdt-color-text-muted, #8ca0ac);
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  font-size: 11px;
  flex-shrink: 0;
}

.gdt-timeline-category {
  color: var(--gdt-color-event, #c9a84c);
  font-size: 10px;
  flex-shrink: 0;
  width: 72px;
}

.gdt-timeline-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.gdt-timeline-node-link {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--gdt-color-selected, #4fa8d8);
  cursor: pointer;
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  font-size: 11px;
  flex-shrink: 0;
}

.gdt-empty {
  padding: 16px;
  color: var(--gdt-color-text-muted, #8ca0ac);
}
</style>
