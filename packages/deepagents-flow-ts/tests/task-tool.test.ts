import { describe, expect, it } from "vitest";
import type { StructuredTool } from "@langchain/core/tools";
import { AppConfigSchema } from "../src/runtime/index.js";
import {
  createTaskTool,
  parseSubagentModelOverride,
} from "../src/app/task.tool.js";

const baseConfig = AppConfigSchema.parse({
  model: { provider: "openai", name: "deepseek-chat" },
});

describe("parseSubagentModelOverride", () => {
  it("plain model name inherits parent provider", () => {
    const result = parseSubagentModelOverride("gpt-4o-mini", baseConfig);
    expect("error" in result).toBe(false);
    if ("config" in result) {
      expect(result.config.model.provider).toBe("openai");
      expect(result.config.model.name).toBe("gpt-4o-mini");
    }
  });

  it("provider/model overrides provider and model together", () => {
    const result = parseSubagentModelOverride("anthropic/claude-sonnet-4-6", baseConfig);
    expect("error" in result).toBe(false);
    if ("config" in result) {
      expect(result.config.model.provider).toBe("anthropic");
      expect(result.config.model.name).toBe("claude-sonnet-4-6");
      expect(result.config.model.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    }
  });

  it("rejects unsupported provider prefixes", () => {
    const result = parseSubagentModelOverride("google/gemini-pro", baseConfig);
    expect(result).toEqual({
      error: "不支持的 model provider，当前仅支持 anthropic/openai: google/gemini-pro",
    });
  });
});

describe("createTaskTool", () => {
  it("rejects subagent tools that are not available", async () => {
    const tool = createTaskTool({
      config: baseConfig,
      parentWorkspaceRoot: process.cwd(),
      buildTools: () => [{ name: "read_file" } as StructuredTool],
      subAgents: [
        {
          name: "researcher",
          description: "Researcher",
          systemPrompt: "You research.",
          tools: ["missing_tool"],
        },
      ],
    });

    const result = await tool.invoke({
      subagent_type: "researcher",
      description: "test",
    });

    expect(result).toContain('Error: subagent "researcher" 配置了未知工具: missing_tool');
  });
});
