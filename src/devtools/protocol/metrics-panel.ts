import type {
  GraphDurationMetrics,
  GraphMetricsSnapshot,
} from "../../core";
import type { InspectorMetricGroup, InspectorMetricsView } from "./types";

const formatDuration = (duration: GraphDurationMetrics): string => {
  if (duration.count === 0) return "no samples";
  const mean = duration.totalMs / duration.count;
  return `${mean.toFixed(1)}ms avg / ${duration.maximumMs.toFixed(1)}ms max (n=${duration.count})`;
};

/**
 * Reshapes the raw metrics snapshot (already well-organised by domain -
 * see diagnostics/metrics.ts) into named groups of label/value rows a UI
 * can render as-is, with duration stats pre-formatted rather than left as
 * raw milliseconds for the component to reformat.
 */
export const computeMetricsView = (
  metrics: GraphMetricsSnapshot | undefined
): InspectorMetricsView => {
  if (!metrics) return { groups: [] };

  const groups: InspectorMetricGroup[] = [
    {
      title: "Events",
      rows: [
        { label: "Retained", value: String(metrics.eventCount) },
        { label: "Dropped", value: String(metrics.droppedEventCount) },
      ],
    },
    {
      title: "Operations",
      rows: Object.entries(metrics.operationCounts).map(([kind, count]) => ({
        label: kind,
        value: String(count),
      })),
    },
    {
      title: "Execution",
      rows: [
        { label: "Active loads", value: String(metrics.activeLoads) },
        { label: "Peak active loads", value: String(metrics.maximumActiveLoads) },
        { label: "Queued loads", value: String(metrics.queuedLoads) },
        { label: "Queue wait", value: formatDuration(metrics.queueWaitDuration) },
        { label: "Fresh-value skips", value: String(metrics.freshValueSkips) },
        { label: "Active-attempt reuses", value: String(metrics.activeAttemptReuses) },
      ],
    },
    {
      title: "Invalidations",
      rows: [
        { label: "Context", value: String(metrics.invalidations.context) },
        { label: "Changed result", value: String(metrics.invalidations.changedResult) },
      ],
    },
    {
      title: "Scheduler",
      rows: [
        { label: "Requested", value: String(metrics.scheduler.requested) },
        { label: "Started", value: String(metrics.scheduler.started) },
        { label: "Completed", value: String(metrics.scheduler.completed) },
        { label: "Failed", value: String(metrics.scheduler.failed) },
      ],
    },
    {
      title: "Refresh policies",
      rows: [
        { label: "Started", value: String(metrics.refreshPolicies.started) },
        { label: "Retries", value: String(metrics.refreshPolicies.retries) },
        { label: "Completed", value: String(metrics.refreshPolicies.completed) },
        { label: "Failed", value: String(metrics.refreshPolicies.failed) },
        { label: "Timed out", value: String(metrics.refreshPolicies.timedOut) },
        { label: "Paused", value: String(metrics.refreshPolicies.paused) },
        { label: "Resumed", value: String(metrics.refreshPolicies.resumed) },
        { label: "Stopped", value: String(metrics.refreshPolicies.stopped) },
      ],
    },
    {
      title: "Transactions",
      rows: [
        { label: "Started", value: String(metrics.transactions.started) },
        { label: "Committed", value: String(metrics.transactions.committed) },
        { label: "Rolled back", value: String(metrics.transactions.rolledBack) },
        { label: "Conflicted", value: String(metrics.transactions.conflicted) },
        { label: "Duration", value: formatDuration(metrics.transactions.duration) },
      ],
    },
    {
      title: "Mutations",
      rows: [
        { label: "Started", value: String(metrics.mutations.started) },
        { label: "Succeeded", value: String(metrics.mutations.succeeded) },
        { label: "Rejected", value: String(metrics.mutations.rejected) },
        { label: "Rollback conflicted", value: String(metrics.mutations.rollbackConflicted) },
        { label: "Unknown outcome", value: String(metrics.mutations.unknown) },
        { label: "Reconciliation failed", value: String(metrics.mutations.reconciliationFailed) },
        { label: "Duration", value: formatDuration(metrics.mutations.duration) },
      ],
    },
    {
      title: "Subscriptions",
      rows: [
        { label: "Direct", value: String(metrics.subscriptions.direct) },
        { label: "Required", value: String(metrics.subscriptions.required) },
      ],
    },
  ];

  return { groups };
};
