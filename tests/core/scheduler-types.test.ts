import { createGraph, createGraphRuntime } from "../../src/core";

const runtime = createGraphRuntime(createGraph({ nodes: [] }));
const state = runtime.getSchedulerState();
const scheduled: boolean = state.isScheduled;
const running: boolean = state.isRunning;
const error: Error | null = state.error;
const settlement: Promise<void> = runtime.whenSettled();
void [scheduled, running, error, settlement];

// @ts-expect-error scheduler snapshots are read-only
state.isRunning = true;
// @ts-expect-error scheduler errors are read-only
state.error = new Error("changed");
