<script setup lang="ts">
import type { InspectorMetricsView } from "../protocol/types";

defineProps<{ view: InspectorMetricsView }>();
</script>

<template>
  <div class="gdt-metrics-panel" :data-testid="'gdt-metrics-panel'">
    <p v-if="view.groups.length === 0" class="gdt-empty">
      No metrics available - pass a diagnostics collector to see them.
    </p>
    <section v-for="group in view.groups" :key="group.title" class="gdt-metric-group">
      <h4>{{ group.title }}</h4>
      <dl class="gdt-metric-rows">
        <template v-for="row in group.rows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.gdt-metrics-panel {
  padding: 12px 16px;
  font-family: var(--gdt-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  color: var(--gdt-color-text, #e4edf1);
  font-size: 12px;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  align-content: start;
}

.gdt-empty {
  color: var(--gdt-color-text-muted, #8ca0ac);
  grid-column: 1 / -1;
}

.gdt-metric-group h4 {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: none;
  color: var(--gdt-color-event, #c9a84c);
  font-weight: 600;
}

.gdt-metric-rows {
  display: grid;
  grid-template-columns: 1fr max-content;
  gap: 3px 10px;
  margin: 0;
}

.gdt-metric-rows dt {
  color: var(--gdt-color-text-muted, #8ca0ac);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gdt-metric-rows dd {
  margin: 0;
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  text-align: right;
}
</style>
