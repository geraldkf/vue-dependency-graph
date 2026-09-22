import {
  normalizeDiagnosticEvents,
  normalizeDiagnosticExport,
  normalizeDiagnosticSnapshot,
  type GraphDiagnosticEvent,
  type GraphDiagnosticExport,
  type GraphDiagnosticSnapshotV1,
} from "../../src/core";

declare const snapshot: GraphDiagnosticSnapshotV1;
declare const events: readonly GraphDiagnosticEvent[];
declare const diagnosticExport: GraphDiagnosticExport;

const normalizedSnapshot: GraphDiagnosticSnapshotV1 = normalizeDiagnosticSnapshot(snapshot);
const normalizedEvents: readonly GraphDiagnosticEvent[] = normalizeDiagnosticEvents(events);
const normalizedExport: GraphDiagnosticExport = normalizeDiagnosticExport(diagnosticExport);
void [normalizedSnapshot, normalizedEvents, normalizedExport];

// @ts-expect-error snapshot normalisation requires a diagnostic snapshot
normalizeDiagnosticSnapshot(events);
// @ts-expect-error event normalisation requires diagnostic events
normalizeDiagnosticEvents(snapshot);
