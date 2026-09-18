<script setup lang="ts">
import { computed } from "vue";
import type { InspectorGraphView } from "../protocol/types";

const props = defineProps<{
  view: InspectorGraphView;
  selectedNodeKey?: string | undefined;
}>();

const emit = defineEmits<{ select: [key: string] }>();

const COLUMN_WIDTH = 176;
const ROW_HEIGHT = 52;
const NODE_WIDTH = 148;
const NODE_HEIGHT = 34;
const EVENT_WIDTH = 132;
const PADDING = 20;

const displayColumn = (column: number): number => column + 1;

const positioned = computed(() => {
  const nodes = props.view.nodes.map(node => ({
    ...node,
    x: PADDING + displayColumn(node.column) * COLUMN_WIDTH,
    y: PADDING + node.row * ROW_HEIGHT,
  }));
  const events = props.view.events.map(event => ({
    ...event,
    x: PADDING + displayColumn(event.column) * COLUMN_WIDTH,
    y: PADDING + event.row * ROW_HEIGHT,
  }));
  const byKey = new Map(
    [...nodes.map(n => [n.key, n] as const), ...events.map(e => [e.key, e] as const)]
  );

  const edges = props.view.edges.flatMap(edge => {
    const from = byKey.get(edge.from);
    const to = byKey.get(edge.to);
    if (!from || !to) return [];
    const fromWidth = "kind" in from ? NODE_WIDTH : EVENT_WIDTH;
    const x1 = from.x + fromWidth;
    const y1 = from.y + NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_HEIGHT / 2;
    const midX = x1 + (x2 - x1) / 2;
    return [
      {
        key: `${edge.kind}:${edge.from}->${edge.to}`,
        kind: edge.kind,
        path: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
      },
    ];
  });

  const width =
    PADDING * 2 + (props.view.columnCount + 1) * COLUMN_WIDTH;
  const height = PADDING * 2 + Math.max(props.view.maxRowCount, 1) * ROW_HEIGHT;

  return { nodes, events, edges, width, height };
});
</script>

<template>
  <div class="gdt-graph-view" role="img" aria-label="Node dependency graph">
    <svg
      v-if="positioned.nodes.length > 0 || positioned.events.length > 0"
      :viewBox="`0 0 ${positioned.width} ${positioned.height}`"
      :width="positioned.width"
      :height="positioned.height"
    >
      <path
        v-for="edge in positioned.edges"
        :key="edge.key"
        :d="edge.path"
        class="gdt-edge"
        :class="`gdt-edge--${edge.kind}`"
        fill="none"
      />

      <g
        v-for="event in positioned.events"
        :key="`event:${event.key}`"
        :transform="`translate(${event.x}, ${event.y})`"
      >
        <rect
          class="gdt-event-node"
          :width="EVENT_WIDTH"
          :height="NODE_HEIGHT"
          rx="2"
        />
        <text class="gdt-event-label" :x="10" :y="NODE_HEIGHT / 2 + 4">
          {{ event.key }}
        </text>
      </g>

      <g
        v-for="node in positioned.nodes"
        :key="`node:${node.key}`"
        :transform="`translate(${node.x}, ${node.y})`"
        class="gdt-node"
        :class="{ 'gdt-node--selected': node.key === selectedNodeKey }"
        role="button"
        tabindex="0"
        :data-testid="`gdt-graph-node-${node.key}`"
        :aria-label="`${node.key}: ${node.status}, ${node.freshness}`"
        @click="emit('select', node.key)"
        @keydown.enter="emit('select', node.key)"
      >
        <rect
          class="gdt-node-body"
          :width="NODE_WIDTH"
          :height="NODE_HEIGHT"
          rx="2"
        />
        <rect
          class="gdt-node-accent"
          :class="[
            `gdt-status--${node.hasError ? 'error' : node.status === 'idle' ? 'idle' : node.status === 'error' ? 'error' : node.freshness === 'fresh' ? 'fresh' : 'stale'}`,
          ]"
          width="3"
          :height="NODE_HEIGHT"
        />
        <text class="gdt-node-label" :x="12" :y="NODE_HEIGHT / 2 + 4">
          {{ node.key }}
        </text>
        <circle
          v-if="node.subscriberCount > 0"
          class="gdt-subscriber-dot"
          :cx="NODE_WIDTH - 10"
          :cy="NODE_HEIGHT / 2"
          r="3"
        />
        <text
          v-if="node.hasRefreshPolicy"
          class="gdt-node-badge"
          :x="NODE_WIDTH - 20"
          :y="NODE_HEIGHT / 2 + 4"
        >&#8635;</text>
      </g>
    </svg>
    <p v-else class="gdt-empty">No nodes in this graph.</p>
  </div>
</template>

<style scoped>
.gdt-graph-view {
  overflow: auto;
  background: var(--gdt-color-bg, #10161a);
}

.gdt-empty {
  padding: 16px;
  color: var(--gdt-color-text-muted, #8ca0ac);
  font-family: var(--gdt-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 13px;
}

.gdt-edge {
  stroke: var(--gdt-color-border-strong, #3a4a54);
  stroke-width: 1.5;
}

.gdt-edge--event {
  stroke: var(--gdt-color-event, #c9a84c);
  stroke-dasharray: 3 3;
}

.gdt-node {
  cursor: pointer;
}

.gdt-node-body {
  fill: var(--gdt-color-surface, #171f24);
  stroke: var(--gdt-color-border, #2a3640);
  stroke-width: 1;
}

.gdt-node--selected .gdt-node-body {
  stroke: var(--gdt-color-selected, #4fa8d8);
  stroke-width: 1.5;
}

.gdt-node-accent {
  stroke: none;
}

.gdt-status--idle { fill: var(--gdt-color-idle, #5b6b74); }
.gdt-status--fresh { fill: var(--gdt-color-success, #4fcb86); }
.gdt-status--stale { fill: var(--gdt-color-stale, #c9a84c); }
.gdt-status--error { fill: var(--gdt-color-error, #e2604f); }

.gdt-node-label {
  fill: var(--gdt-color-text, #e4edf1);
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  font-size: 11px;
}

.gdt-subscriber-dot {
  fill: var(--gdt-color-success, #4fcb86);
}

.gdt-node-badge {
  fill: var(--gdt-color-text-muted, #8ca0ac);
  font-size: 11px;
}

.gdt-event-node {
  fill: transparent;
  stroke: var(--gdt-color-event, #c9a84c);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}

.gdt-event-label {
  fill: var(--gdt-color-event, #c9a84c);
  font-family: var(--gdt-font-mono, ui-monospace, "SF Mono", "Cascadia Code", monospace);
  font-size: 10px;
  font-style: italic;
}
</style>
