import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The inspector loads template *source* when INSPECTOR_TEMPLATE_SOURCE=1 (its
// default test mode). Template source imports via the `@runtime/*` tsconfig path
// alias, but vitest does not read the template's tsconfig `paths`. Mirror that
// single mapping here so the source-import channel resolves. (`.js` specifiers
// resolve to the corresponding `.ts` files via vite's built-in extension trying.)
const templateRuntime = fileURLToPath(new URL("../template/src/runtime", import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30000,
  },
  resolve: {
    alias: [{ find: /^@runtime\//, replacement: `${templateRuntime}/` }],
  },
});
