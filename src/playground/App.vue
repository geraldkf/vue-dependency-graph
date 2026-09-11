<template>
  <main>
    <h1>Vue Dependency Graph</h1>
    <p>Single-package framework playground</p>
    <ul aria-label="Logical layers">
      <li>{{ coreLayerName }}</li>
      <li>{{ vueLayerName }}</li>
      <li>{{ devtoolsLayerName }}</li>
    </ul>
  </main>
</template>

<script setup lang="ts">
import { coreLayerName } from "../core";
import { devtoolsLayerName } from "../devtools";
import { vueLayerName } from "../vue";
</script>
