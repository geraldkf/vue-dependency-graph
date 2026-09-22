import { describe, expect, it } from "vitest";
import { defineContextNode, defineDataNode, defineQuery } from "../../src/core";

const jobSeekerId = defineContextNode({
  key: "query-job-seeker-id",
  initialValue: 101,
});

const appointments = defineDataNode({
  key: "query-appointments",
  dependencies: [jobSeekerId] as const,
  initialValue: [] as string[],
  load: async () => ["appointment"],
});

describe("query definitions", () => {
  it("creates an immutable aliased node group", () => {
    const nodes = {
      currentJobSeeker: jobSeekerId,
      appointments,
    } as const;

    const query = defineQuery({
      key: "appointments-page",
      nodes,
    });

    expect(query).toEqual({
      key: "appointments-page",
      nodes,
    });
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(query.nodes)).toBe(true);
  });

  it("copies the node map before freezing it", () => {
    const nodes: Record<string, typeof jobSeekerId> = {
      currentJobSeeker: jobSeekerId,
    };

    const query = defineQuery({
      key: "copied-query",
      nodes,
    });

    nodes.other = jobSeekerId;

    expect(query.nodes).toEqual({ currentJobSeeker: jobSeekerId });
  });

  it("rejects a blank query key", () => {
    expect(() =>
      defineQuery({
        key: "   ",
        nodes: { currentJobSeeker: jobSeekerId },
      }),
    ).toThrow("Query key must not be blank.");
  });

  it("rejects a blank node alias from untyped input", () => {
    expect(() =>
      defineQuery({
        key: "invalid-alias-query",
        nodes: { " ": jobSeekerId },
      }),
    ).toThrow("Query node alias must not be blank.");
  });
});
