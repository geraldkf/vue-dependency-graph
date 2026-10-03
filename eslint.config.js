// @ts-check
import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "vue-dependency-graph/**",
      "browser-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginVue.configs["flat/recommended"],
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)) },
    },
  },
  {
    // Library (core/) and devtools code is DOM-agnostic by design where possible,
    // but the Vue layer, devtools panel, and playground do run in the browser.
    files: ["src/**/*.{ts,vue}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,ts,mjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      // The codebase relies on noUncheckedIndexedAccess / exactOptionalPropertyTypes
      // in tsconfig for real safety; keep lint focused on things the compiler can't catch.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "vue/multi-word-component-names": "off",
    },
  },
  {
    // Test files declare fixtures purely to exercise the type system
    // (e.g. `const x = value as Type` used only via `typeof x`), and some
    // spec files import error classes for documentation of what a call
    // can throw even where a given test doesn't assert on all of them.
    // Keep these visible without failing CI on pre-existing test debt,
    // rather than mass-editing many spec files as drive-by lint cleanup.
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Integration fixtures intentionally mount several small components together.
      "vue/one-component-per-file": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      // Cyclic/forward-referencing graph fixtures declare `let x!: T` and
      // assign it after something that already captures a reference to it
      // (self cycles, forward references) — prefer-const can't tell that
      // apart from an ordinary reassignable local.
      "prefer-const": "off",
    },
  },
  eslintConfigPrettier,
);
