import type { EventDefinition } from "./types";

export const defineEvent = <TPayload>(
  key: string
): EventDefinition<TPayload> => {
  if (key.trim().length === 0) {
    throw new Error("Event key must not be blank.");
  }

  return Object.freeze({ key });
};
