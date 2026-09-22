import { defineComponent, h, type Component } from "vue";
import { render } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineQuery,
  type GraphRuntime,
} from "../../src/core";
import { useQuery, type UseQueryResult } from "../../src/vue";

const createFixture = () => {
  const jobSeekerId = defineContextNode({
    key: "use-query-job-seeker-id",
    initialValue: 101,
  });
  const appointments = defineDataNode({
    key: "use-query-appointments",
    dependencies: [jobSeekerId] as const,
    initialValue: [] as string[],
    load: async ({ get }) => [`appointment-${get(jobSeekerId)}`],
  });
  const capabilityStatus = defineDataNode({
    key: "use-query-capability-status",
    dependencies: [jobSeekerId] as const,
    initialValue: "",
    load: async ({ get }) => `status-${get(jobSeekerId)}`,
  });
  const query = defineQuery({
    key: "use-query-page",
    nodes: {
      appointments,
      capabilityStatus,
    },
  });
  const runtime = createGraphRuntime(
    createGraph({ nodes: [jobSeekerId, appointments, capabilityStatus] }),
  );

  return { appointments, capabilityStatus, query, runtime };
};

type Fixture = ReturnType<typeof createFixture>;
type QueryResult = UseQueryResult<Fixture["query"]>;

const mountProbe = (runtime: GraphRuntime, query: Fixture["query"]) => {
  let captured: QueryResult | undefined;
  const Probe: Component = defineComponent({
    setup() {
      captured = useQuery(query, { runtime });
      return () => h("div");
    },
  });

  const rendered = render(Probe);
  if (captured === undefined) {
    throw new Error("Query result was not captured.");
  }

  return { captured, ...rendered };
};

describe("useQuery", () => {
  it("loads query nodes and exposes them through their aliases", async () => {
    const { query, runtime } = createFixture();
    const { captured } = mountProbe(runtime, query);

    await runtime.whenSettled();

    expect(captured.nodes.appointments.data.value).toEqual(["appointment-101"]);
    expect(captured.nodes.capabilityStatus.data.value).toBe("status-101");
    expect(captured.nodes.appointments.status.value).toBe("success");
    expect(captured.isSuccess.value).toBe(true);
    expect(captured.isError.value).toBe(false);
  });

  it("uses one subscription contribution for the complete query", () => {
    const { appointments, capabilityStatus, query, runtime } = createFixture();

    mountProbe(runtime, query);

    expect(runtime.getSubscriptionState(appointments).direct).toBe(1);
    expect(runtime.getSubscriptionState(capabilityStatus).direct).toBe(1);
  });

  it("releases all query subscription ownership on unmount", () => {
    const { appointments, capabilityStatus, query, runtime } = createFixture();
    const { unmount } = mountProbe(runtime, query);

    unmount();

    expect(runtime.getSubscriptionState(appointments).direct).toBe(0);
    expect(runtime.getSubscriptionState(capabilityStatus).direct).toBe(0);
  });

  it("preserves useNodes aggregate failure semantics", async () => {
    const context = defineContextNode({
      key: "use-query-failure-context",
      initialValue: 1,
    });
    const successful = defineDataNode({
      key: "use-query-successful",
      dependencies: [context] as const,
      initialValue: "",
      load: async () => "ready",
    });
    const failing = defineDataNode({
      key: "use-query-failing",
      dependencies: [context] as const,
      initialValue: "",
      load: async () => {
        throw new Error("query load failed");
      },
    });
    const query = defineQuery({
      key: "use-query-failure",
      nodes: { successful, failing },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context, successful, failing] }));

    let captured: UseQueryResult<typeof query> | undefined;
    const Probe = defineComponent({
      setup() {
        captured = useQuery(query, { runtime });
        return () => h("div");
      },
    });
    render(Probe);
    await runtime.whenSettled();

    if (captured === undefined) {
      throw new Error("Query result was not captured.");
    }

    expect(captured.nodes.successful.hasSuccessfulValue.value).toBe(true);
    expect(captured.nodes.failing.error.value?.message).toBe("query load failed");
    expect(captured.isError.value).toBe(true);
    expect(captured.isSuccess.value).toBe(false);
    expect(captured.errors.value).toHaveLength(1);
  });

  it("requires an active Vue effect scope", () => {
    const { query, runtime } = createFixture();

    expect(() => useQuery(query, { runtime })).toThrow(
      /useQuery\(\) must be called inside setup\(\)/,
    );
  });
});

describe("useQuery operations", () => {
  it("prefetches and refreshes through the captured query definition", async () => {
    const context = defineContextNode({
      key: "use-query-operations-context",
      initialValue: 1,
    });
    let request = 0;
    const load = vi.fn(async () => ++request);
    const data = defineDataNode({
      key: "use-query-operations-data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const query = defineQuery({
      key: "use-query-operations",
      nodes: { context, data },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context, data] }));

    let captured: UseQueryResult<typeof query> | undefined;
    const Probe = defineComponent({
      setup() {
        captured = useQuery(query, { runtime });
        return () => h("div");
      },
    });
    render(Probe);
    await runtime.whenSettled();

    if (captured === undefined) {
      throw new Error("Query result was not captured.");
    }

    expect(load).toHaveBeenCalledOnce();
    await captured.prefetch();
    expect(load).toHaveBeenCalledOnce();

    await captured.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    expect(captured.nodes.data.data.value).toBe(2);
  });
});
