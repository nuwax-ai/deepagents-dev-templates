import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf-8")) as T;
}

describe("agent package manifests", () => {
  it("declares the nuwaclaw ACP engine launch and graph contract", () => {
    const manifest = readJson<{
      engine: string;
      source: { type: string; package?: string };
      alternativeSources: Array<{ type: string }>;
      bin: { start: string; graph: string };
      graph: { schema: string; command: string };
      env: { optional: string[]; oneOfRequired: string[][] };
      metadata: { framework: string; nodeVersion: string };
    }>("agent-package.json");

    expect(manifest.engine).toBe("deepagents-app");
    expect(manifest.source).toMatchObject({
      type: "s3",
      bucket: "nuwax-packages",
    });
    expect(manifest.alternativeSources.map((source) => source.type)).toEqual(["npm", "tgz", "git", "s3-channel"]);
    expect(manifest.bin).toEqual({
      start: "dist/index.js",
      graph: "dist/index.js graph",
    });
    expect(manifest.graph).toMatchObject({
      schema: "nuwaclaw.agent-code-graph.v1",
      command: "node dist/index.js graph",
    });
    expect(manifest.env.optional).toContain("ACP_SESSION_CONFIG_JSON");
    expect(manifest.env.optional).toContain("OPENAI_MODEL");
    expect(manifest.env.optional).toContain("OPENAI_BASE_URL");
    expect(manifest.env.optional).toContain("LOG_LEVEL");
    expect(manifest.env.optional).toContain("LOG_DIR");
    expect(manifest.env.optional).toContain("PLATFORM_AGENT_ID");
    expect(manifest.env.optional).toContain("PLATFORM_SPACE_ID");
    expect(manifest.env.oneOfRequired).toContainEqual(["ANTHROPIC_API_KEY"]);
    expect(manifest.env.oneOfRequired).toContainEqual(["ANTHROPIC_AUTH_TOKEN"]);
    expect(manifest.metadata.framework).toBe("deepagents-js");
    expect(manifest.metadata.nodeVersion).toBe(">=20.0.0");
  });

  it("keeps template constraints aligned with the requested platform rules", () => {
    const template = readJson<{
      acceptance: { commands: string[] };
      constraints: {
        promptSource: string;
        toolPriority: string[];
        variableCreation: string;
        mcpMergeStrategy: string;
      };
      requiredFiles: string[];
      distribution: { supportedSources: string[]; entryPoint: string };
    }>("template.manifest.json");

    expect(template.acceptance.commands).toContain("npm run test:acp-smoke");
    expect(template.acceptance.commands).toContain("npm run graph");
    expect(template.constraints).toMatchObject({
      promptSource: "acp-only",
      variableCreation: "via-agent-variable-tool",
      mcpMergeStrategy: "session-wins",
    });
    expect(template.constraints.toolPriority).toEqual([
      "platform-mcp",
      "builtin-custom",
      "deepagents-builtin",
      "write-code",
    ]);
    expect(template.requiredFiles).toContain("docs/architecture/nuwaclaw-engine-integration.md");
    expect(template.distribution.supportedSources).toEqual(["npm", "tgz", "git"]);
    expect(template.distribution.entryPoint).toBe("dist/index.js");
  });
});
