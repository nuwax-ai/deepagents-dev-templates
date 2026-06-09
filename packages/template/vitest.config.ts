import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@runtime": path.resolve(__dirname, "src/runtime"),
      "@app": path.resolve(__dirname, "src/app"),
    },
  },
});
