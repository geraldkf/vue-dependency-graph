import { createPinia } from "pinia";
import { useDependencyGraphStore } from "../../src/playground/dependency-graph-store";
import {
  selectedUserId,
  userProfile,
} from "../../src/playground/scenarios/context-switching-nodes";
import { useNode, useNodes } from "../../src/vue";

const store = useDependencyGraphStore(createPinia());

const profile = useNode(userProfile, { runtime: store.runtime });
const profileValue: string = profile.data.value;
void profileValue;

const query = useNodes([selectedUserId, userProfile], {
  runtime: store.runtime,
});
const selectedId: number = query.results[0].value.data;
const selectedProfile: string = query.results[1].value.data;
void [selectedId, selectedProfile];

// @ts-expect-error Pinia ownership must not weaken the node's data type
const wrongProfileType: number = profile.data.value;
void wrongProfileType;
