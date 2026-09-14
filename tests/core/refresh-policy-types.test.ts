import {
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  pollUntil,
  refreshInterval,
  staleAfter,
  type PollUntilPolicy,
} from "../../src/core";

interface Progress {
  readonly state: "running" | "completed" | "failed";
  readonly percentage: number;
}

interface OtherValue {
  readonly value: string;
}

const polling = pollUntil<Progress>({
  intervalMs: 2_000,
  timeoutMs: 60_000,
  stopWhen: value => value.state === "completed" && value.percentage === 100,
  failWhen: value => value.state === "failed",
});

const typedPolling: PollUntilPolicy<Progress> = polling;
void typedPolling;

const progressNode = defineDataNode({
  key: "progress",
  initialValue: { state: "running", percentage: 0 } as Progress,
  load: async () => ({ state: "completed", percentage: 100 }) as Progress,
  refresh: polling,
});
void progressNode;

const otherPolicy = pollUntil<OtherValue>({
  intervalMs: 1,
  timeoutMs: 2,
  stopWhen: value => value.value.length > 0,
});

// @ts-expect-error polling policy value types are not interchangeable
const invalidPolicy: PollUntilPolicy<Progress> = otherPolicy;
void invalidPolicy;

defineDataNode({
  key: "stale-number",
  initialValue: 0,
  load: async () => 1,
  refresh: staleAfter({ durationMs: 1 }),
});

defineDataNode({
  key: "interval-string",
  initialValue: "",
  load: async () => "loaded",
  refresh: refreshInterval({ intervalMs: 1 }),
});

// @ts-expect-error retry strategy must be fixed or exponential
refreshInterval({ intervalMs: 1, retry: { strategy: "linear" } });

// @ts-expect-error timeout is required for polling
pollUntil<Progress>({ intervalMs: 1, stopWhen: () => false });

defineContextNode({
  key: "context-with-policy",
  initialValue: 1,
  // @ts-expect-error context nodes do not support refresh policies
  refresh: staleAfter({ durationMs: 1 }),
});

defineDerivedNode({
  key: "derived-with-policy",
  dependencies: [] as const,
  derive: () => 1,
  // @ts-expect-error derived nodes do not support refresh policies
  refresh: staleAfter({ durationMs: 1 }),
});
