import type {
  GraphDiagnosticError,
  GraphDiagnosticEvent,
  GraphDiagnosticsOptions,
  GraphOperationRequestedDiagnosticEvent,
} from "./types";

type DiagnosticEnvelopeKey =
  | "schemaVersion"
  | "sequence"
  | "timestamp"
  | "runtimeId";

type DiagnosticEventInput = GraphDiagnosticEvent extends infer TEvent
  ? TEvent extends GraphDiagnosticEvent
    ? Omit<TEvent, DiagnosticEnvelopeKey>
    : never
  : never;

interface OperationRequestedInput {
  readonly type: GraphOperationRequestedDiagnosticEvent["type"];
  readonly operation: GraphOperationRequestedDiagnosticEvent["operation"];
  readonly nodeKeys: readonly string[];
  readonly queryKey?: string;
}

export interface RuntimeDiagnosticEmitter {
  readonly emitRuntimeCreated: (nodeKeys: readonly string[]) => void;
  readonly emitOperationRequested: (input: OperationRequestedInput) => string;
  readonly createOperationId: () => string;
  readonly emit: (event: DiagnosticEventInput) => void;
  readonly now: () => number;
  readonly toError: (error: Error) => GraphDiagnosticError;
  readonly isEnabled: boolean;
  readonly runtimeId: string;
}

let nextRuntimeId = 1;

const createDefaultRuntimeId = (): string => `runtime-${nextRuntimeId++}`;

const createDefaultEnvironment = () => ({
  now: Date.now,
  createRuntimeId: createDefaultRuntimeId,
});

const freezeValue = <TValue>(value: TValue): TValue => {
  if (Array.isArray(value)) return Object.freeze([...value]) as TValue;
  if (typeof value === "object" && value !== null) {
    return Object.freeze({ ...value }) as TValue;
  }
  return value;
};

export const createRuntimeDiagnosticEmitter = (
  options?: GraphDiagnosticsOptions,
): RuntimeDiagnosticEmitter => {
  const sink = options?.sink;
  if (!sink) {
    return Object.freeze({
      emitRuntimeCreated: () => undefined,
      emitOperationRequested: () => "",
      createOperationId: () => "",
      emit: () => undefined,
      now: () => 0,
      toError: (error: Error) => Object.freeze({ name: error.name, message: error.message }),
      isEnabled: false,
      runtimeId: "diagnostics-disabled",
    });
  }

  const environment = options?.environment ?? createDefaultEnvironment();
  let runtimeId: string;
  try {
    runtimeId = environment.createRuntimeId();
  } catch {
    runtimeId = createDefaultRuntimeId();
  }
  let sequence = 0;
  let operationSequence = 0;

  const now = (): number => {
    try {
      return environment.now();
    } catch {
      return Date.now();
    }
  };

  const dispatch = (event: GraphDiagnosticEvent): void => {
    try {
      sink.emit(Object.freeze(event));
    } catch {
      // Diagnostics are observational and must never alter runtime behaviour.
    }
  };

  const emit = (input: DiagnosticEventInput): void => {
    const event = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, freezeValue(value)])
    ) as unknown as DiagnosticEventInput;
    dispatch(Object.freeze({
      schemaVersion: 1,
      sequence: ++sequence,
      timestamp: now(),
      runtimeId,
      ...event,
    }) as GraphDiagnosticEvent);
  };

  const createOperationId = (): string =>
    `${runtimeId}:operation-${++operationSequence}`;

  const emitRuntimeCreated = (nodeKeys: readonly string[]): void => {
    emit({ type: "runtime.created", nodeKeys });
  };

  const emitOperationRequested = (
    input: OperationRequestedInput,
  ): string => {
    const operationId = createOperationId();
    emit({ ...input, operationId });
    return operationId;
  };

  return Object.freeze({
    emitRuntimeCreated,
    emitOperationRequested,
    createOperationId,
    emit,
    now,
    toError: (error: Error) => Object.freeze({
      name: error.name,
      message: error.message,
    }),
    isEnabled: true,
    runtimeId,
  });
};
