<template>
  <section aria-label="Polling progress scenario">
    <h2>Polling Progress</h2>
    <p>
      Drive a poll-until workflow with deterministic time, responses, retries, and lifecycle
      controls.
    </p>

    <div>
      <button :disabled="mounted" @click="mountConsumer">Mount consumer</button>
      <button :disabled="!mounted" @click="unmountConsumer">Unmount consumer</button>
      <button :disabled="!mounted || paused" @click="advanceOnePoll">Advance one poll</button>
      <button :disabled="!mounted" @click="complete">Complete</button>
      <button :disabled="!mounted" @click="fail">Fail</button>
      <button :disabled="!mounted || snapshot.data.state === 'running'" @click="startNewJob">
        Start new job
      </button>
      <button :disabled="!mounted" @click="triggerTimeout">Trigger timeout</button>
      <button :disabled="!mounted" @click="failNextRequest">Fail next request</button>
      <button :disabled="paused" @click="pause">Pause</button>
      <button :disabled="!paused" @click="resume">Resume</button>
      <button @click="reset">Reset</button>
    </div>

    <dl>
      <dt>Consumer</dt>
      <dd data-testid="polling-consumer">{{ mounted ? "mounted" : "unmounted" }}</dd>
      <dt>Operation</dt>
      <dd data-testid="polling-operation">{{ snapshot.data.operationId }}</dd>
      <dt>Progress</dt>
      <dd data-testid="polling-progress">{{ snapshot.data.percent }}%</dd>
      <dt>Business state</dt>
      <dd data-testid="polling-business-state">{{ snapshot.data.state }}</dd>
      <dt>Node status</dt>
      <dd data-testid="polling-node-status">{{ snapshot.status }}</dd>
      <dt>Freshness</dt>
      <dd data-testid="polling-freshness">{{ snapshot.freshness }}</dd>
      <dt>Error</dt>
      <dd data-testid="polling-error">{{ snapshot.error?.name ?? "none" }}</dd>
      <dt>Requests</dt>
      <dd data-testid="polling-request-count">{{ requestCount }}</dd>
      <dt>Active requests</dt>
      <dd data-testid="polling-active-count">{{ activeRequestCount }}</dd>
      <dt>Maximum concurrent requests</dt>
      <dd data-testid="polling-maximum-active">{{ maximumConcurrentRequests }}</dd>
      <dt>Retry attempt</dt>
      <dd data-testid="polling-retry-attempt">{{ retryAttempt }}</dd>
      <dt>Scheduled delay</dt>
      <dd data-testid="polling-next-delay">{{ nextDelay ?? "none" }}</dd>
      <dt>Outstanding timers</dt>
      <dd data-testid="polling-timer-count">{{ outstandingTimerCount }}</dd>
      <dt>Lifecycle</dt>
      <dd data-testid="polling-lifecycle">{{ paused ? "paused" : "active" }}</dd>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import type { NodeSubscription } from "../../core";
import {
  createPollingProgressHarness,
  type PollingProgressHarness,
} from "./polling-progress-model";

let harness: PollingProgressHarness = createPollingProgressHarness();
let consumer: NodeSubscription | undefined;
let stopObservingRuntime: (() => void) | undefined;

const snapshot = ref(harness.getState());
const mounted = ref(false);
const paused = ref(false);
const requestCount = ref(0);
const activeRequestCount = ref(0);
const maximumConcurrentRequests = ref(0);
const retryAttempt = ref(0);
const nextDelay = ref<number | undefined>();
const outstandingTimerCount = ref(0);

const sync = (): void => {
  snapshot.value = harness.getState();
  paused.value = harness.isPaused();
  requestCount.value = harness.getRequestCount();
  activeRequestCount.value = harness.getActiveRequestCount();
  maximumConcurrentRequests.value = harness.getMaximumConcurrentRequests();
  retryAttempt.value = harness.getRetryAttempt();
  nextDelay.value = harness.getNextDelay();
  outstandingTimerCount.value = harness.getOutstandingTimerCount();
};

const observeRuntime = (): void => {
  stopObservingRuntime?.();
  stopObservingRuntime = harness.runtime.onChange(sync);
};
observeRuntime();

// Policy-driven refreshes (triggered by the fake timers below) run
// through execute() directly rather than the subscription scheduler, so
// runtime.whenSettled() cannot observe them, and the promise chain from
// timer callback -> refresh -> reconcile -> next scheduled timer varies
// in depth by scenario (plain success, retry, multi-step polling, ...).
// Counting a fixed number of microtask ticks -- or even waiting for the
// observable state to look "stable" for a few ticks -- is fragile: a
// longer chain can look quiescent before it actually is, and callers
// that invoke advance() back-to-back (e.g. triggerTimeout's loop) then
// advance the fake clock again before the previous cycle finished
// scheduling its next timer, permanently losing a poll interval.
//
// A real macrotask boundary sidesteps the guesswork: the JS engine
// always drains the *entire* microtask queue -- however deep, including
// microtasks scheduled by other microtasks -- before running the next
// macrotask. So awaiting a single real setTimeout is sufficient to
// guarantee every pending .then()/.finally() in the chain above has run.
const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  sync();
};

const mountConsumer = async (): Promise<void> => {
  consumer = harness.subscribe();
  mounted.value = true;

  // Subscriptions request scheduler work in a microtask. Let that request
  // become observable before waiting for scheduler settlement.
  await Promise.resolve();
  await harness.runtime.whenSettled();
  await settle();
};

const unmountConsumer = (): void => {
  consumer?.unsubscribe();
  consumer = undefined;
  mounted.value = false;
  sync();
};

const advance = async (durationMs: number): Promise<void> => {
  harness.advanceBy(durationMs);
  await settle();
};

const advanceOnePoll = (): Promise<void> => advance(1_000);

const complete = async (): Promise<void> => {
  harness.complete();
  await advance(1_000);
};

const fail = async (): Promise<void> => {
  harness.fail();
  await advance(1_000);
};

const startNewJob = async (): Promise<void> => {
  await harness.startNewJob();
  await settle();
};

const triggerTimeout = async (): Promise<void> => {
  for (let step = 0; step < 4; step += 1) await advance(1_000);
};

const failNextRequest = async (): Promise<void> => {
  harness.failNextRequest();
  await advance(1_000);
};

const pause = (): void => {
  harness.pause();
  sync();
};

const resume = (): void => {
  harness.resume();
  sync();
};

const reset = (): void => {
  consumer?.unsubscribe();
  stopObservingRuntime?.();
  consumer = undefined;
  harness.runtime.shutdown();
  harness = createPollingProgressHarness();
  mounted.value = false;
  observeRuntime();
  sync();
};

onBeforeUnmount(() => {
  consumer?.unsubscribe();
  stopObservingRuntime?.();
  harness.runtime.shutdown();
});
</script>
