/**
 * Unit tests for resolveSummarizerModel() and the compaction.summarizerModel
 * config override. Verifies that:
 *  - The schema accepts summarizerModel as an optional field
 *  - resolveSummarizerModel instantiates the override model name when set
 *  - resolveSummarizerModel falls back to the agent's model name when unset
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppConfig } from "../../../../src/runtime/config/config-loader.js";

function makeConfig(overrides: Partial<AppConfig["compaction"]> = {}, modelOverrides: Partial<AppConfig["model"]> = {}): AppConfig {
  return {
    agent: { name: "test-agent" },
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-6",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      authTokenEnv: "ANTHROPIC_AUTH_TOKEN",
      baseUrl: undefined,
      settings: { temperature: 0, maxTokens: 4096 },
      ...modelOverrides,
    },
    compaction: {
      enabled: true,
      contextWindow: 200_000,
      triggerThreshold: 0.8,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
      ...overrides,
    },
    // The rest of AppConfig isn't relevant for resolveSummarizerModel; cast
    // through unknown to satisfy the type without mocking the full config tree.
  } as unknown as AppConfig;
}

describe("compaction.summarizerModel", () => {
  beforeEach(() => {
    // ChatAnthropic / ChatOpenAI throw at construction if no API key is set.
    // These tests only inspect the resulting `model` field — no real call.
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
  });

  describe("schema", () => {
    it("accepts an undefined summarizerModel (default behavior)", async () => {
      const { CompactionConfigSchema } = await import("../../../../src/runtime/config/config-loader.js");
      const parsed = CompactionConfigSchema.parse({});
      expect(parsed.summarizerModel).toBeUndefined();
    });

    it("accepts a string summarizerModel", async () => {
      const { CompactionConfigSchema } = await import("../../../../src/runtime/config/config-loader.js");
      const parsed = CompactionConfigSchema.parse({ summarizerModel: "claude-haiku-4-5" });
      expect(parsed.summarizerModel).toBe("claude-haiku-4-5");
    });
  });

  describe("resolveSummarizerModel", () => {
    it("uses the agent's model name when summarizerModel is unset", async () => {
      // Reset the module cache so the cache key in resolveSummarizerModel is fresh
      vi.resetModules();
      const { resolveSummarizerModel } = await import("../../../../src/runtime/helpers.js");
      const config = makeConfig({ summarizerModel: undefined });
      const model = resolveSummarizerModel(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((model as any).model).toBe("claude-sonnet-4-6");
    });

    it("uses compaction.summarizerModel when set (Anthropic)", async () => {
      vi.resetModules();
      const { resolveSummarizerModel } = await import("../../../../src/runtime/helpers.js");
      const config = makeConfig({ summarizerModel: "claude-haiku-4-5" });
      const model = resolveSummarizerModel(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((model as any).model).toBe("claude-haiku-4-5");
    });

    it("uses compaction.summarizerModel when set (OpenAI)", async () => {
      vi.resetModules();
      const { resolveSummarizerModel } = await import("../../../../src/runtime/helpers.js");
      const config = makeConfig(
        { summarizerModel: "gpt-4o-mini" },
        { provider: "openai", name: "gpt-4o" }
      );
      const model = resolveSummarizerModel(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((model as any).model).toBe("gpt-4o-mini");
    });
  });
});
