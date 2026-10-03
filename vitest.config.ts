import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // The retention tests (tests/retention) check that values become
    // garbage-collectable, which needs `globalThis.gc`.
    pool: "forks",
    execArgv: ["--expose-gc"],
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          environment: "node",
          include: ["tests/core/**/*.spec.ts", "tests/tooling/**/*.spec.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
          include: [
            "tests/vue/**/*.spec.ts",
            "tests/playground/**/*.spec.ts",
            "tests/devtools/**/*.spec.ts",
            "tests/retention/**/*.spec.ts",
          ],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/core/**/*.ts", "src/vue/**/*.ts", "src/devtools/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/playground/**"],
      // Set a little below the current baseline (~97/92/98/97) so CI catches
      // real regressions without being flaky on incidental branch coverage.
      thresholds: {
        statements: 95,
        branches: 88,
        functions: 95,
        lines: 95,
      },
    },
  },
});
