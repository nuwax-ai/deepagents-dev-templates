import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Build output, deps, and non-TS files (prettier owns formatting).
    ignores: ["dist/**", "node_modules/**", "coverage/**", "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.json"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type-aware rules that `tsc` can't catch (floating / misused promises).
    // Scoped to src/ — the runtime that ships — so type-aware linting stays fast
    // and doesn't pull scripts/tests outside the tsconfig project graph.
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // Pragmatic downgrades so turning lint on doesn't redden the existing tree;
    // these are warnings to chip away at, not hard failures.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // Honour the `_`-prefix convention for intentionally-unused params/vars
      // (e.g. interface-required callback args the impl doesn't read).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  eslintConfigPrettier
);
