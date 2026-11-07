import { createGraphMetricsReducer, type GraphMetricsSnapshot } from "./metrics";
import type { GraphDiagnosticEvent, GraphDiagnosticSink } from "./types";
import { createRuntimeObserver } from "../observation/observer";

export interface InMemoryGraphDiagnosticsOptions {
  readonly capacity: number;
}

export interface InMemoryGraphDiagnostics extends GraphDiagnosticSink {
  /** Observes emitted events and resets. Listener failures are isolated. */
  readonly onChange: (listener: () => void) => () => void;
  readonly getEvents: () => readonly GraphDiagnosticEvent[];
  readonly getMetrics: () => GraphMetricsSnapshot;
  readonly reset: () => void;
}

/** True when the event and every object it holds is already frozen. */
const isDeeplyFrozen = (event: GraphDiagnosticEvent): boolean => {
  if (!Object.isFrozen(event)) return false;
  for (const value of Object.values(event)) {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) return false;
  }
  return true;
};

/**
 * Events the runtime emitted are already frozen, one level deep; they are kept
 * as they are. Anything else handed to the sink directly is copied and frozen
 * so retained events can never be changed by their producer.
 */
const freezeEvent = (event: GraphDiagnosticEvent): GraphDiagnosticEvent => {
  if (isDeeplyFrozen(event)) return event;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    copy[key] = Array.isArray(value)
      ? Object.freeze([...value])
      : typeof value === "object" && value !== null
        ? Object.freeze({ ...value })
        : value;
  }
  return Object.freeze(copy) as unknown as GraphDiagnosticEvent;
};

export const createInMemoryGraphDiagnostics = (
  options: InMemoryGraphDiagnosticsOptions,
): InMemoryGraphDiagnostics => {
  if (!Number.isInteger(options.capacity) || options.capacity < 1) {
    throw new Error("Diagnostic capacity must be a positive integer.");
  }

  // A ring buffer: once full, each new event overwrites the oldest in place
  // instead of shifting the whole array.
  const events: GraphDiagnosticEvent[] = [];
  let oldest = 0;
  const metrics = createGraphMetricsReducer();
  const observer = createRuntimeObserver();
  let droppedEventCount = 0;

  const emit = (event: GraphDiagnosticEvent): void => {
    const retainedEvent = freezeEvent(event);
    metrics.record(retainedEvent);
    if (events.length < options.capacity) {
      events.push(retainedEvent);
    } else {
      events[oldest] = retainedEvent;
      oldest = (oldest + 1) % options.capacity;
      droppedEventCount += 1;
    }
    observer.notify();
  };

  const getEvents = (): readonly GraphDiagnosticEvent[] =>
    Object.freeze(
      oldest === 0 ? [...events] : [...events.slice(oldest), ...events.slice(0, oldest)],
    );

  const getMetrics = (): GraphMetricsSnapshot => metrics.getSnapshot(droppedEventCount);

  const reset = (): void => {
    events.length = 0;
    oldest = 0;
    droppedEventCount = 0;
    metrics.reset();
    observer.notify();
  };

  return Object.freeze({ emit, getEvents, getMetrics, reset, onChange: observer.onChange });
};
