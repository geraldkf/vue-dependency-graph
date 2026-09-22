<script setup lang="ts">
import { computed, ref } from "vue";
import type { GraphRuntime, InMemoryGraphDiagnostics } from "../../core";
import { useGraphDevtools } from "../composables/use-graph-devtools";
import {
  useOfflineDevtoolsSnapshot,
  InvalidDevtoolsExportError,
} from "../composables/use-offline-devtools-snapshot";
import GraphView from "./GraphView.vue";
import NodeInspector from "./NodeInspector.vue";
import Timeline from "./Timeline.vue";
import MetricsPanel from "./MetricsPanel.vue";

const props = defineProps<{
  runtime: GraphRuntime;
  diagnostics: InMemoryGraphDiagnostics;
}>();

type Tab = "graph" | "node" | "timeline" | "metrics";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "node", label: "Node" },
  { id: "timeline", label: "Timeline" },
  { id: "metrics", label: "Metrics" },
];
const activeTab = ref<Tab>("graph");

const live = useGraphDevtools({ runtime: props.runtime, diagnostics: props.diagnostics });
const offline = useOfflineDevtoolsSnapshot();

const mode = computed<"live" | "offline">(() => (offline.loaded.value ? "offline" : "live"));
const active = computed(() => (mode.value === "live" ? live : offline));

const importError = ref<string | undefined>(undefined);
const fileInput = ref<HTMLInputElement>();

const onExportClick = (): void => {
  const blob = new Blob([live.exportSnapshot()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `graph-devtools-snapshot-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const onImportClick = (): void => {
  importError.value = undefined;
  fileInput.value?.click();
};

const onFileChange = async (event: Event): Promise<void> => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    offline.loadFromJson(await file.text());
  } catch (error) {
    importError.value =
      error instanceof InvalidDevtoolsExportError ? error.message : "Could not read that file.";
  } finally {
    (event.target as HTMLInputElement).value = "";
  }
};

const onReturnToLiveClick = (): void => {
  offline.clear();
  importError.value = undefined;
};
</script>

<template>
  <div class="gdt-panel">
    <header class="gdt-toolbar">
      <nav class="gdt-tabs">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="gdt-tab"
          :class="{ 'gdt-tab--active': activeTab === tab.id }"
          :data-testid="`gdt-tab-${tab.id}`"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div class="gdt-toolbar-actions">
        <span v-if="mode === 'offline'" class="gdt-mode-badge" :data-testid="'gdt-mode-badge'">
          viewing offline snapshot
        </span>
        <button
          v-if="mode === 'offline'"
          type="button"
          class="gdt-action-button"
          @click="onReturnToLiveClick"
        >
          Return to live
        </button>
        <button
          v-if="mode === 'live'"
          type="button"
          class="gdt-action-button"
          @click="onExportClick"
        >
          Export snapshot
        </button>
        <button type="button" class="gdt-action-button" @click="onImportClick">
          Load snapshot
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json"
          class="gdt-file-input"
          @change="onFileChange"
        />
      </div>
    </header>

    <p v-if="importError" class="gdt-import-error" :data-testid="'gdt-import-error'">
      {{ importError }}
    </p>

    <div class="gdt-panel-body">
      <GraphView
        v-show="activeTab === 'graph'"
        :view="active.graphView.value"
        :selected-node-key="active.selectedNodeKey.value"
        @select="
          (key) => {
            active.select(key);
            activeTab = 'node';
          }
        "
      />
      <NodeInspector
        v-if="activeTab === 'node'"
        :detail="active.selectedNodeDetail.value"
        @select="active.select"
      />
      <Timeline
        v-if="activeTab === 'timeline'"
        :entries="active.timeline.value"
        :selected-node-key="active.selectedNodeKey.value"
        @select="
          (key) => {
            active.select(key);
            activeTab = 'node';
          }
        "
      />
      <MetricsPanel v-if="activeTab === 'metrics'" :view="active.metricsView.value" />
    </div>
  </div>
</template>

<style scoped>
.gdt-panel {
  --gdt-color-bg: #10161a;
  --gdt-color-surface: #171f24;
  --gdt-color-surface-raised: #1e2830;
  --gdt-color-border: #2a3640;
  --gdt-color-border-subtle: #1a2329;
  --gdt-color-border-strong: #3a4a54;
  --gdt-color-text: #e4edf1;
  --gdt-color-text-muted: #8ca0ac;
  --gdt-color-idle: #5b6b74;
  --gdt-color-selected: #4fa8d8;
  --gdt-color-success: #4fcb86;
  --gdt-color-stale: #c9a84c;
  --gdt-color-error: #e2604f;
  --gdt-color-event: #c9a84c;
  --gdt-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --gdt-font-mono: ui-monospace, "SF Mono", "Cascadia Code", monospace;

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 320px;
  background: var(--gdt-color-bg);
  border: 1px solid var(--gdt-color-border);
  font-family: var(--gdt-font-ui);
}

.gdt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--gdt-color-border);
  background: var(--gdt-color-surface);
}

.gdt-tabs {
  display: flex;
}

.gdt-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--gdt-color-text-muted);
  padding: 10px 16px;
  font-size: 12px;
  cursor: pointer;
}

.gdt-tab--active {
  color: var(--gdt-color-text);
  border-bottom-color: var(--gdt-color-selected);
}

.gdt-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 10px;
}

.gdt-mode-badge {
  color: var(--gdt-color-stale);
  font-size: 11px;
}

.gdt-action-button {
  background: var(--gdt-color-surface-raised);
  border: 1px solid var(--gdt-color-border);
  color: var(--gdt-color-text);
  border-radius: 2px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}

.gdt-action-button:hover {
  border-color: var(--gdt-color-selected);
}

.gdt-file-input {
  display: none;
}

.gdt-import-error {
  margin: 0;
  padding: 6px 16px;
  background: color-mix(in srgb, var(--gdt-color-error) 15%, transparent);
  color: var(--gdt-color-error);
  font-size: 12px;
}

.gdt-panel-body {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.gdt-panel-body > * {
  flex: 1;
  min-width: 0;
}
</style>
