<template>
  <section aria-label="Aggregate query scenario">
    <h2>Aggregate Query</h2>
    <p>
      <label>
        <input type="checkbox" v-model="metricCLoader.shouldFail.value" />
        Make metric C fail
      </label>
    </p>
    <p>
      <button @click="handleReload">Reload all</button>
    </p>
    <ul>
      <li data-testid="metric-a">
        A: {{ query.results[0].value.status }} —
        {{ query.results[0].value.data }}
      </li>
      <li data-testid="metric-b">
        B: {{ query.results[1].value.status }} —
        {{ query.results[1].value.data }}
      </li>
      <li data-testid="metric-c">
        C: {{ query.results[2].value.status }} —
        {{ query.results[2].value.data }} —
        {{ query.results[2].value.error?.message ?? "(no error)" }}
      </li>
    </ul>
    <p data-testid="aggregate-loading">
      Aggregate loading: {{ query.isLoading.value }}
    </p>
    <p data-testid="aggregate-error">
      Aggregate error: {{ query.isError.value }}
    </p>
    <p data-testid="aggregate-success">
      Aggregate success: {{ query.isSuccess.value }}
    </p>
    <p data-testid="aggregate-errors-count">
      Error count: {{ query.errors.value.length }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { useGraphRuntime, useNodes } from "../../vue";
import { metricA, metricB, metricC, metricCLoader } from "./aggregate-query-nodes";

const runtime = useGraphRuntime();
const query = useNodes([metricA, metricB, metricC]);

const handleReload = (): void => {
  // Same rejection-handling reasoning as the error-and-retry scenario:
  // refresh() rejects when any listed node fails, on top of recording it
  // in each node's own reactive state, which query.results/query.isError
  // already reflect. Nothing further to do with the rejection itself.
  void runtime.refresh([metricA, metricB, metricC]).catch(() => {});
};
</script>
