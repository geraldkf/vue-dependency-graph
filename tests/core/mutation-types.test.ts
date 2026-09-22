import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  type MutationDefinition,
  type MutationExecuteContext,
  type MutationInput,
  type MutationResult,
} from "../../src/core";

interface SaveInput {
  readonly value: string;
}

interface SaveResult {
  readonly id: number;
  readonly value: string;
}

const save = defineMutation({
  key: "value.save",
  execute: async ({ input, signal }: MutationExecuteContext<SaveInput>) => {
    const value: string = input.value;
    const aborted: boolean = signal.aborted;
    void aborted;
    return { id: 1, value } satisfies SaveResult;
  },
});

const definition: MutationDefinition<SaveInput, SaveResult> = save;
void definition;

type SaveMutationInput = MutationInput<typeof save>;
type SaveMutationResult = MutationResult<typeof save>;

const input: SaveMutationInput = { value: "value" };
const result: SaveMutationResult = { id: 1, value: "value" };
void [input, result];

const context = defineContextNode({
  key: "mutation-types-context",
  initialValue: 1,
});
const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
const promise: Promise<SaveResult> = runtime.mutate(save, { value: "value" });
void promise;

// @ts-expect-error mutation input must match the definition
runtime.mutate(save, { value: 123 });

// @ts-expect-error mutation input cannot omit required fields
runtime.mutate(save, {});

const data = defineDataNode({
  key: "mutation-types-data",
  initialValue: [] as string[],
  load: async () => ["loaded"],
});
const derived = defineDerivedNode({
  key: "mutation-types-derived",
  dependencies: [data] as const,
  derive: ({ get }) => get(data).length,
});

runtime.mutate(
  save,
  { value: "value" },
  {
    optimistic: (effects, mutationInput) => {
      const value: string = mutationInput.value;
      void value;
      effects.update(data, (current) => [...current, "pending"]);

      // @ts-expect-error optimistic updates cannot target context nodes
      effects.update(context, (current) => current + 1);

      // @ts-expect-error optimistic updates cannot target derived nodes
      effects.update(derived, (current) => current + 1);
    },
    classifyFailure: (error) => {
      void error;
      return "rejected";
    },
  },
);

runtime.mutate(
  save,
  { value: "value" },
  {
    onSuccess: (effects, remoteResult, mutationInput) => {
      const id: number = remoteResult.id;
      const value: string = mutationInput.value;
      void [id, value];

      effects.update(data, (current) => [...current, remoteResult.value]);

      // @ts-expect-error updater result must match the data-node value
      effects.update(data, (current) => current.length);

      // @ts-expect-error context nodes cannot be directly reconciled
      effects.update(context, (current) => current + 1);

      // @ts-expect-error derived nodes cannot be directly reconciled
      effects.update(derived, (current) => current + 1);

      effects.invalidate([data, derived]);
      // @ts-expect-error context nodes cannot be invalidated by mutation effects
      effects.invalidate([context]);

      const saved = defineEvent<{ readonly id: number }>("mutation.saved");
      effects.publish(saved, { id: remoteResult.id });
      // @ts-expect-error mutation event payload must match the event definition
      effects.publish(saved, { id: "invalid" });
    },
  },
);

runtime.mutate(
  save,
  { value: "value" },
  {
    // @ts-expect-error failure classifier must return a supported classification
    classifyFailure: () => "retry",
  },
);

void defineMutation<SaveInput, SaveResult>({
  key: "invalid-result",
  // @ts-expect-error mutation execute result must match TResult
  execute: async () => ({ id: "invalid", value: "value" }),
});
