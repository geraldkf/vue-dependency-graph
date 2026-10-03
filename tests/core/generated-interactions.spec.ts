import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  type NodeSubscription,
} from "../../src/core";

describe("seeded public API interaction sequences", () => {
  it.each([1, 7, 42, 1234, 9127, 65535])(
    "preserves state and demand invariants for seed %s",
    async (seed) => {
      let random = seed;
      const next = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random;
      };
      const context = defineContextNode({ key: "selected", initialValue: 0 });
      const changed = defineEvent<void>("changed");
      let requests = 0;
      const value = defineDataNode({
        key: "value",
        dependencies: [context],
        initialValue: -1,
        invalidatedBy: [changed],
        load: async ({ get }) => {
          requests += 1;
          return get(context);
        },
      });
      const doubled = defineDerivedNode({
        key: "doubled",
        dependencies: [value],
        derive: ({ get }) => get(value) * 2,
      });
      const runtime = createGraphRuntime(createGraph({ nodes: [context, value, doubled] }), {
        maxConcurrentLoads: 1,
      });
      const rejection = new Error("known rejection");
      const mutation = defineMutation({
        key: "reject",
        execute: async () => {
          throw rejection;
        },
      });
      const subscriptions: NodeSubscription[] = [];
      for (let step = 0; step < 80; step += 1) {
        switch (next() % 7) {
          case 0:
            runtime.setContext(context, next() % 10);
            break;
          case 1:
            await runtime.transaction((tx) => {
              tx.setContext(context, next() % 10);
              tx.publish(changed, undefined);
            });
            break;
          case 2:
            subscriptions.push(runtime.subscribeNodes([doubled]));
            break;
          case 3:
            subscriptions.pop()?.unsubscribe();
            break;
          case 4:
            runtime.publish(changed, undefined);
            break;
          case 5:
            await runtime.refresh([value]);
            break;
          case 6:
            await runtime.execute([value]);
            await expect(
              runtime.mutate(mutation, undefined, {
                optimistic: (e) => e.update(value, (current) => current + 100),
                classifyFailure: () => "rejected",
              }),
            ).rejects.toBe(rejection);
            break;
        }
        await runtime.whenSettled();
        expect(runtime.getSubscriptionState(doubled).direct).toBe(subscriptions.length);
        expect(runtime.getSubscriptionState(value).required).toBe(subscriptions.length);
        if (subscriptions.length) {
          expect(runtime.getState(value)).toMatchObject({
            data: runtime.getState(context).data,
            status: "success",
            freshness: "fresh",
          });
          expect(runtime.getState(doubled).data).toBe(runtime.getState(context).data * 2);
        }
        expect(runtime.getSchedulerState()).toMatchObject({ isRunning: false, isScheduled: false });
      }
      expect(requests).toBeGreaterThan(0);
      runtime.shutdown();
      for (const subscription of subscriptions) subscription.unsubscribe();
      expect(runtime.getSubscriptionState(value).total).toBe(0);
    },
  );
});
