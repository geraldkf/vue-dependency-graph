<script setup lang="ts">
import { computed } from "vue";
import type { InspectorNodeDetail } from "../protocol/types";

const props = defineProps<{ detail?: InspectorNodeDetail | undefined }>();
const emit = defineEmits<{ select: [key: string] }>();

const valueText = computed(() => {
  const value = props.detail?.value;
  if (!value) return null;
  if (value.status === "omitted") return "(omitted from diagnostics)";
  if (value.status === "redaction-failed") {
    return `(redaction failed: ${value.error?.message ?? "unknown error"})`;
  }
  try {
    return JSON.stringify(value.data, null, 2);
  } catch {
    return "(value could not be serialised)";
  }
});
</script>

<template>
  <div class="gdt-node-inspector">
    <p v-if="!detail" class="gdt-empty">Select a node to inspect it.</p>
    <template v-else>
      <header class="gdt-inspector-header">
        <h3 :data-testid="'gdt-inspector-key'">{{ detail.key }}</h3>
        <span class="gdt-kind-badge">{{ detail.kind }}</span>
      </header>

      <dl class="gdt-fact-grid">
        <dt>Status</dt>
        <dd :data-testid="'gdt-inspector-status'">{{ detail.status }}</dd>
        <dt>Freshness</dt>
        <dd>{{ detail.freshness }}</dd>
        <dt>Generation</dt>
        <dd>{{ detail.generation }}</dd>
        <dt>Has successful value</dt>
        <dd>{{ detail.hasSuccessfulValue ? "yes" : "no" }}</dd>
        <dt>Subscribers</dt>
        <dd>
          {{ detail.subscribers.total }}
          (direct {{ detail.subscribers.direct }}, required {{ detail.subscribers.required }})
        </dd>
      </dl>

      <section v-if="detail.error" class="gdt-error-block" :data-testid="'gdt-inspector-error'">
        <h4>Error</h4>
        <p>{{ detail.error.name }}: {{ detail.error.message }}</p>
      </section>

      <section v-if="detail.refreshPolicy" class="gdt-section">
        <h4>Refresh policy</h4>
        <dl class="gdt-fact-grid">
          <dt>Kind</dt>
          <dd>{{ detail.refreshPolicy.kind }}</dd>
          <dt>Refreshing</dt>
          <dd>{{ detail.refreshPolicy.refreshing ? "yes" : "no" }}</dd>
          <dt>Retry count</dt>
          <dd>{{ detail.refreshPolicy.retryCount }}</dd>
          <dt v-if="detail.refreshPolicy.remainingDelayMs !== undefined">Next in</dt>
          <dd v-if="detail.refreshPolicy.remainingDelayMs !== undefined">
            {{ Math.max(0, Math.round(detail.refreshPolicy.remainingDelayMs)) }}ms
          </dd>
        </dl>
      </section>

      <section v-if="detail.attemptMetrics" class="gdt-section">
        <h4>Execution metrics</h4>
        <dl class="gdt-fact-grid">
          <dt>Started / succeeded / failed</dt>
          <dd>
            {{ detail.attemptMetrics.started }} / {{ detail.attemptMetrics.succeeded }} /
            {{ detail.attemptMetrics.failed }}
          </dd>
          <dt>Blocked / aborted / discarded</dt>
          <dd>
            {{ detail.attemptMetrics.blocked }} / {{ detail.attemptMetrics.aborted }} /
            {{ detail.attemptMetrics.discarded }}
          </dd>
          <dt v-if="detail.attemptMetrics.meanDurationMs !== null">Mean duration</dt>
          <dd v-if="detail.attemptMetrics.meanDurationMs !== null">
            {{ detail.attemptMetrics.meanDurationMs.toFixed(1) }}ms
          </dd>
        </dl>
      </section>

      <section v-if="detail.dependencies.length > 0" class="gdt-section">
        <h4>Dependencies</h4>
        <ul class="gdt-link-list">
          <li v-for="dependency in detail.dependencies" :key="dependency.key">
            <button type="button" @click="emit('select', dependency.key)">
              {{ dependency.key }}
            </button>
            <span class="gdt-muted">({{ dependency.status }})</span>
          </li>
        </ul>
      </section>

      <section v-if="detail.descendants.length > 0" class="gdt-section">
        <h4>Descendants</h4>
        <ul class="gdt-link-list">
          <li v-for="descendant in detail.descendants" :key="descendant.key">
            <button type="button" @click="emit('select', descendant.key)">
              {{ descendant.key }}
            </button>
            <span class="gdt-muted">({{ descendant.status }})</span>
          </li>
        </ul>
      </section>

      <section v-if="detail.invalidatedByEvents.length > 0" class="gdt-section">
        <h4>Invalidated by</h4>
        <ul class="gdt-link-list">
          <li v-for="eventKey in detail.invalidatedByEvents" :key="eventKey">
            {{ eventKey }}
          </li>
        </ul>
      </section>

      <section v-if="valueText" class="gdt-section">
        <h4>Value</h4>
        <pre class="gdt-value-block" :data-testid="'gdt-inspector-value'">{{ valueText }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.gdt-node-inspector {
  padding: 16px;
  font-family: var(--gdt-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  color: var(--gdt-color-text, #e4edf1);
  font-size: 13px;
  overflow: auto;
}

.gdt-empty {
  color: var(--gdt-color-text-muted, #8ca0ac);
}

.gdt-inspector-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}

.gdt-inspector-header h3 {
  margin: 0;
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  font-size: 15px;
  font-weight: 600;
}

.gdt-kind-badge {
  color: var(--gdt-color-text-muted, #8ca0ac);
  border: 1px solid var(--gdt-color-border, #2a3640);
  border-radius: 2px;
  padding: 1px 6px;
  font-size: 11px;
}

.gdt-fact-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0 0 12px;
}

.gdt-fact-grid dt {
  color: var(--gdt-color-text-muted, #8ca0ac);
}

.gdt-fact-grid dd {
  margin: 0;
}

.gdt-section {
  margin: 14px 0;
  padding-top: 12px;
  border-top: 1px solid var(--gdt-color-border, #2a3640);
}

.gdt-section h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--gdt-color-text-muted, #8ca0ac);
  font-weight: 600;
}

.gdt-error-block {
  padding: 10px 12px;
  border: 1px solid var(--gdt-color-error, #e2604f);
  border-radius: 2px;
  color: var(--gdt-color-error, #e2604f);
  margin-bottom: 12px;
}

.gdt-error-block h4 {
  margin: 0 0 4px;
  color: inherit;
}

.gdt-link-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gdt-link-list button {
  background: none;
  border: none;
  color: var(--gdt-color-selected, #4fa8d8);
  cursor: pointer;
  padding: 0;
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  font-size: 12px;
  text-decoration: underline;
}

.gdt-muted {
  color: var(--gdt-color-text-muted, #8ca0ac);
  font-size: 11px;
  margin-left: 4px;
}

.gdt-value-block {
  background: var(--gdt-color-bg, #10161a);
  border: 1px solid var(--gdt-color-border, #2a3640);
  border-radius: 2px;
  padding: 8px;
  margin: 0;
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  font-size: 11px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
