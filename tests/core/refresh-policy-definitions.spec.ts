import { describe, expect, it, vi } from "vitest";
import {
  GraphValidationError,
  createGraph,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  pollUntil,
  refreshInterval,
  staleAfter,
  type AnyNodeDefinition,
} from "../../src/core";

describe("refresh policy definitions", () => {
  it("creates immutable normalized policy descriptors without evaluating predicates", () => {
    const stopWhen = vi.fn(() => false);
    const failWhen = vi.fn(() => false);
    const retry = {
      strategy: "exponential" as const,
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 1_000,
    };

    const stale = staleAfter({ durationMs: 30_000 });
    const interval = refreshInterval({
      intervalMs: 10_000,
      retry: { strategy: "fixed", maxRetries: 2, delayMs: 250 },
    });
    const polling = pollUntil<number>({
      intervalMs: 2_000,
      timeoutMs: 60_000,
      stopWhen,
      failWhen,
      retry,
    });

    retry.maxRetries = 99;

    expect(stale).toEqual({ kind: "stale-after", durationMs: 30_000 });
    expect(interval).toEqual({
      kind: "interval",
      intervalMs: 10_000,
      retry: {
        strategy: "fixed",
        maxRetries: 2,
        delayMs: 250,
        jitterRatio: 0,
      },
    });
    expect(polling).toEqual({
      kind: "poll-until",
      intervalMs: 2_000,
      timeoutMs: 60_000,
      stopWhen,
      failWhen,
      retry: {
        strategy: "exponential",
        maxRetries: 3,
        initialDelayMs: 100,
        multiplier: 2,
        maxDelayMs: 1_000,
        jitterRatio: 0,
      },
    });
    expect(polling.retry?.maxRetries).toBe(3);
    expect(Object.isFrozen(stale)).toBe(true);
    expect(Object.isFrozen(interval)).toBe(true);
    expect(Object.isFrozen(interval.retry)).toBe(true);
    expect(Object.isFrozen(polling)).toBe(true);
    expect(Object.isFrozen(polling.retry)).toBe(true);
    expect(stopWhen).not.toHaveBeenCalled();
    expect(failWhen).not.toHaveBeenCalled();
  });

  it("retains a policy on a data definition and leaves omitted policies undefined", () => {
    const policy = staleAfter({ durationMs: 1_000 });
    const withPolicy = defineDataNode({
      key: "with-policy",
      initialValue: 0,
      load: async () => 1,
      refresh: policy,
    });
    const withoutPolicy = defineDataNode({
      key: "without-policy",
      initialValue: 0,
      load: async () => 1,
    });

    expect(withPolicy.refresh).toBe(policy);
    expect(withoutPolicy.refresh).toBeUndefined();
  });

  it.each([
    ["stale duration", () => staleAfter({ durationMs: 0 })],
    ["interval duration", () => refreshInterval({ intervalMs: Number.NaN })],
    [
      "poll timeout",
      () => pollUntil({ intervalMs: 1, timeoutMs: Infinity, stopWhen: () => false }),
    ],
    [
      "retry count",
      () =>
        refreshInterval({
          intervalMs: 1,
          retry: { strategy: "fixed", maxRetries: 1.5, delayMs: 1 },
        }),
    ],
    [
      "exponential multiplier",
      () =>
        refreshInterval({
          intervalMs: 1,
          retry: {
            strategy: "exponential",
            maxRetries: 1,
            initialDelayMs: 1,
            maxDelayMs: 2,
            multiplier: 0.5,
          },
        }),
    ],
    [
      "maximum delay",
      () =>
        refreshInterval({
          intervalMs: 1,
          retry: {
            strategy: "exponential",
            maxRetries: 1,
            initialDelayMs: 2,
            maxDelayMs: 1,
          },
        }),
    ],
    [
      "jitter",
      () =>
        refreshInterval({
          intervalMs: 1,
          retry: {
            strategy: "fixed",
            maxRetries: 1,
            delayMs: 1,
            jitterRatio: 1.1,
          },
        }),
    ],
  ])("rejects invalid %s", (_name: string, createPolicy: () => unknown) => {
    expect(createPolicy).toThrow();
  });

  it("rejects invalid polling predicates supplied through untyped input", () => {
    expect(() =>
      pollUntil({
        intervalMs: 1,
        timeoutMs: 2,
        stopWhen: undefined,
      } as unknown as Parameters<typeof pollUntil>[0]),
    ).toThrowError("stopWhen must be a function.");

    expect(() =>
      pollUntil({
        intervalMs: 1,
        timeoutMs: 2,
        stopWhen: () => false,
        failWhen: "invalid",
      } as unknown as Parameters<typeof pollUntil>[0]),
    ).toThrowError("failWhen must be a function when provided.");
  });

  it("rejects forged invalid policy metadata during graph creation", () => {
    const data = defineDataNode({
      key: "forged-data",
      initialValue: 0,
      load: async () => 1,
    });
    const forged = {
      ...data,
      refresh: { kind: "unknown" },
    } as unknown as AnyNodeDefinition;

    expect(() => createGraph({ nodes: [forged] })).toThrowError(
      expect.objectContaining<Partial<GraphValidationError>>({
        code: "INVALID_REFRESH_POLICY",
        message: expect.stringContaining("forged-data"),
      }),
    );
  });

  it.each(["context", "derived"])(
    "rejects forged refresh metadata on a %s node",
    (kind: string) => {
      const node =
        kind === "context"
          ? defineContextNode({ key: "forged-context", initialValue: 1 })
          : defineDerivedNode({
              key: "forged-derived",
              dependencies: [] as const,
              derive: () => 1,
            });
      const forged = {
        ...node,
        refresh: staleAfter({ durationMs: 1 }),
      } as unknown as AnyNodeDefinition;

      expect(() => createGraph({ nodes: [forged] })).toThrowError(
        expect.objectContaining<Partial<GraphValidationError>>({
          code: "INVALID_REFRESH_POLICY",
        }),
      );
    },
  );
});
