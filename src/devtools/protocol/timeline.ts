import type { GraphDiagnosticEvent } from "../../core";
import type { InspectorTimelineCategory, InspectorTimelineEntry } from "./types";

const CATEGORY_BY_PREFIX: readonly (readonly [string, InspectorTimelineCategory])[] = [
  ["operation.", "operation"],
  ["runtime.", "operation"],
  ["subscription.", "subscription"],
  ["scheduler.", "scheduler"],
  ["context.", "context"],
  ["node.invalidated", "invalidation"],
  ["node.execution.", "execution"],
  ["node.load.", "execution"],
  ["node.derive.", "execution"],
  ["event.", "event"],
  ["transaction.", "transaction"],
  ["refresh-policy.", "refresh-policy"],
  ["node.value-released", "release"],
  ["mutation.", "mutation"],
];

const categoryOf = (type: string): InspectorTimelineCategory =>
  CATEGORY_BY_PREFIX.find(([prefix]) => type.startsWith(prefix))?.[1] ?? "operation";

const FAILURE_SUFFIXES = [
  "failed",
  "rolled-back",
  "rollback-conflicted",
  "outcome-unknown",
  "reconciliation-failed",
  "conflicted",
  "timed-out",
];

const isFailureType = (type: string): boolean =>
  FAILURE_SUFFIXES.some((suffix) => type.endsWith(suffix));

const readNodeKey = (event: GraphDiagnosticEvent): string | undefined =>
  "nodeKey" in event ? event.nodeKey : undefined;

const humanise = (type: string): string =>
  type
    .split(/[.-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const labelOf = (event: GraphDiagnosticEvent, nodeKey: string | undefined): string =>
  nodeKey === undefined ? humanise(event.type) : `${humanise(event.type)} - ${nodeKey}`;

/**
 * Events arrive from `getEvents()` oldest-first already (the in-memory
 * collector's own ordering guarantee); this preserves that order rather
 * than re-sorting, so a timeline built from a partial/rotated window is
 * still internally consistent.
 */
export const computeTimeline = (
  events: readonly GraphDiagnosticEvent[],
): readonly InspectorTimelineEntry[] =>
  events.map((event): InspectorTimelineEntry => {
    const nodeKey = readNodeKey(event);
    return {
      sequence: event.sequence,
      timestamp: event.timestamp,
      type: event.type,
      category: categoryOf(event.type),
      ...(event.operationId === undefined ? {} : { operationId: event.operationId }),
      ...(event.causeId === undefined ? {} : { causeId: event.causeId }),
      ...(nodeKey === undefined ? {} : { nodeKey }),
      label: labelOf(event, nodeKey),
      isFailure: isFailureType(event.type),
    };
  });
