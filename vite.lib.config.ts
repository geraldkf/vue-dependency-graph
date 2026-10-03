import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const entry = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * The published JavaScript. Declarations come from `vue-tsc` (see
 * `tsconfig.build.json`); this build only has to turn the three entry
 * points into real ES modules, which bare `tsc` output is not: it leaves
 * extensionless relative imports Node cannot resolve, and it cannot compile
 * the devtools `.vue` components at all.
 *
 * Building the entries together lets Rollup share one copy of `core`
 * between them, so classes such as `GraphMutationError` stay the same class
 * whichever entry point a consumer imports them through.
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    // `vue-tsc` has already written the declarations into `dist`.
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: {
        "core/index": entry("src/core/index.ts"),
        "vue/index": entry("src/vue/index.ts"),
        "devtools/index": entry("src/devtools/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["vue"],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (asset) =>
          (asset.names ?? []).some((name) => name.endsWith(".css"))
            ? "devtools/style.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
