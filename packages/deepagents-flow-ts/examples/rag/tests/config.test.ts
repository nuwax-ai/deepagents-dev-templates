/**
 * 配置装配冒烟测试（确定性，无 LLM / 无 MCP）
 *
 * 证明随包发布的 config/rag-agent.config.json 能被 loadRagConfig 正确加载，
 * 并由 buildGraphConfig 组装成可用的图配置。
 */

import { describe, it, expect } from "vitest";
import { loadRagConfig } from "../config.js";
import { buildGraphConfig } from "../run-rag.js";

describe("shipped rag-agent.config.json", () => {
  it("加载为合法的 AppConfig + rag 设置", () => {
    const loaded = loadRagConfig();
    expect(loaded.appConfig.model.provider).toBeTruthy();
    expect(loaded.appConfig.model.name).toBeTruthy();
    expect(loaded.rag.enabled).toBe(true);
    expect(loaded.configPath).toContain("rag-agent.config.json");
  });

  it("buildGraphConfig 产出检索源 + 合并默认值", () => {
    const cfg = buildGraphConfig(loadRagConfig());
    expect(cfg.retrievalTools.length).toBeGreaterThan(0);
    expect(Object.keys(cfg.mcpServers).length).toBeGreaterThan(0);
    expect(cfg.appConfig).toBeDefined();
    // DEFAULT_RAG_CONFIG 合并生效
    expect(cfg.prepare.maxContextTokens).toBeGreaterThan(0);
    expect(cfg.agent.streaming).toBe(true);
  });
});
