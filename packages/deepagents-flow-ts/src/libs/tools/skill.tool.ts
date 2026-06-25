/**
 * load_skill 工具 —— 渐进式读取某个 skill 的完整说明（SKILL.md 正文）。
 *
 * 配合 renderSkillsSection：系统提示词只列 skill 的 name + description（省 token），
 * 模型需要时调 load_skill(name) 拉完整正文再执行（deepagents progressive disclosure）。
 * 返回时附带 skillRoot/scriptsDir，避免 cwd 与 skill 目录不一致时全盘 find。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiscoveredSkill } from "../../runtime/index.js";

/** 在 SKILL.md 正文前注入 skill 根目录与 scripts 路径元信息。 */
function renderSkillMetaHeader(skill: DiscoveredSkill): string {
  const skillRoot = dirname(skill.path);
  const scriptsDir = join(skillRoot, "scripts");
  const scriptsNote = existsSync(scriptsDir)
    ? `- **scriptsDir**: ${scriptsDir}`
    : `- **scriptsDir**: ${scriptsDir}（目录不存在，脚本可能位于 skillRoot 其他子路径）`;

  return `## Skill 元信息
- **skillRoot**: ${skillRoot}
${scriptsNote}

> 执行本 skill 的 \`./scripts/*.sh\` 前，先 \`cd\` 到 skillRoot，或使用 scriptsDir 下的绝对路径。禁止 \`find /\` 全盘搜索。

`;
}

export function createSkillTool(skills: DiscoveredSkill[]) {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const names = skills.map((s) => s.name).join(", ") || "(none)";

  return tool(
    async ({ name }) => {
      const skill = byName.get(name);
      if (!skill) return `Error: 未找到 skill "${name}"。可用: ${names}`;
      try {
        const body = readFileSync(skill.path, "utf-8");
        return renderSkillMetaHeader(skill) + body;
      } catch (err) {
        return `Error: 读取 skill "${name}" 失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "load_skill",
      description: `读取某个 skill 的完整说明（SKILL.md 正文 + skillRoot 路径），先读再据此执行。可用 skills: ${names}。`,
      schema: z.object({
        name: z.string().describe("skill 名（见系统提示词 Available Skills 列表）"),
      }),
    }
  );
}
