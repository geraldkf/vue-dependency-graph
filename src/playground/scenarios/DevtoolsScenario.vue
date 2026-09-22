<template>
  <section aria-labelledby="devtools-heading">
    <h2 id="devtools-heading">Devtools</h2>
    <p>
      A live graph with a context, a data node with an event-invalidation and a refresh policy, a
      derived node, and a mutation - enough variety to exercise every tab in the panel below. Use
      the controls to generate activity, then try Export snapshot followed by Load snapshot to see
      the offline viewer.
    </p>

    <div aria-label="Devtools scenario controls">
      <button data-testid="devtools-change-user" @click="onChangeUser">Change user</button>
      <button data-testid="devtools-book-appointment" @click="onBookAppointment">
        Book appointment
      </button>
      <button data-testid="devtools-fail-next" @click="onFailNext">Fail next load</button>
    </div>
    <p data-testid="devtools-last-action">Last action: {{ lastAction }}</p>

    <div class="devtools-panel-host">
      <GraphDevtoolsPanel :runtime="scenario.runtime" :diagnostics="scenario.diagnostics" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onScopeDispose, ref } from "vue";
import { GraphDevtoolsPanel } from "../../devtools";
import { createDevtoolsPlaygroundScenario } from "./devtools-model";

const scenario = createDevtoolsPlaygroundScenario();
const lastAction = ref("initial subscription");

const onChangeUser = (): void => {
  scenario.changeUser();
  lastAction.value = "user changed";
};

const onBookAppointment = async (): Promise<void> => {
  await scenario.bookAppointment();
  lastAction.value = "appointment booked";
};

const onFailNext = (): void => {
  scenario.failNextLoad();
  lastAction.value = "next load will fail";
};

onScopeDispose(() => {
  scenario.dispose();
});
</script>

<style scoped>
.devtools-panel-host {
  height: 520px;
  margin-top: 16px;
}
</style>
