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

const freezeEvent = (event: GraphDiagnosticEvent): GraphDiagnosticEvent =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(event).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? Object.freeze([...value])
          : typeof value === "object" && value !== null
            ? Object.freeze({ ...value })
            : value,
      ]),
    ),
  ) as unknown as GraphDiagnosticEvent;

export const createInMemoryGraphDiagnostics = (
  options: InMemoryGraphDiagnosticsOptions,
): InMemoryGraphDiagnostics => {
  if (!Number.isInteger(options.capacity) || options.capacity < 1) {
    throw new Error("Diagnostic capacity must be a positive integer.");
  }

  const events: GraphDiagnosticEvent[] = [];
  const metrics = createGraphMetricsReducer();
  const observer = createRuntimeObserver();
  let droppedEventCount = 0;

  const emit = (event: GraphDiagnosticEvent): void => {
    const retainedEvent = freezeEvent(event);
    metrics.record(retainedEvent);
    events.push(retainedEvent);
    if (events.length > options.capacity) {
      events.shift();
      droppedEventCount += 1;
    }
    observer.notify();
  };

  const getEvents = (): readonly GraphDiagnosticEvent[] => Object.freeze([...events]);

  const getMetrics = (): GraphMetricsSnapshot => metrics.getSnapshot(droppedEventCount);

  const reset = (): void => {
    events.length = 0;
    droppedEventCount = 0;
    metrics.reset();
    observer.notify();
  };

  return Object.freeze({ emit, getEvents, getMetrics, reset, onChange: observer.onChange });
};
