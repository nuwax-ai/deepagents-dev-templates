import { defineConfig } from "vitest/config";

/**
 * 测试期把 deepagents-app-ts logger 降到 `error`。
 *
 * 该 logger 的 info/warn **总是写 stderr**（见 app-ts runtime/logger.ts），
 * 跑测试时会刷出大量结构化 JSON、淹没断言与失败信息。这里默认静音，
 * 排障时用 `LOG_LEVEL=debug pnpm test` 覆盖（已有 LOG_LEVEL 优先）。
 *
 * 注：本文件已在 scripts/lib/staging.mjs 的 STAGING_EXCLUDES（vitest.config.*）中，
 * 不进入发布制品。
 */
export default defineConfig({
  test: {
    env: {
      LOG_LEVEL: process.env.LOG_LEVEL || "error",
    },
  },
});
