/**
 * load_skill 工具 —— 渐进式读取某个 skill 的完整说明（SKILL.md 正文）。
 *
 * 配合 renderSkillsSection：系统提示词只列 skill 的 name + description（省 token），
 * 模型需要时调 load_skill(name) 拉完整正文再执行（deepagents progressive disclosure）。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync } from "node:fs";
import type { DiscoveredSkill } from "../../runtime/index.js";

export function createSkillTool(skills: DiscoveredSkill[]) {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const names = skills.map((s) => s.name).join(", ") || "(none)";

  return tool(
    async ({ name }) => {
      const skill = byName.get(name);
      if (!skill) return `Error: 未找到 skill "${name}"。可用: ${names}`;
      try {
        return readFileSync(skill.path, "utf-8");
      } catch (err) {
        return `Error: 读取 skill "${name}" 失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "load_skill",
      description: `读取某个 skill 的完整说明（SKILL.md 正文），先读再据此执行。可用 skills: ${names}。`,
      schema: z.object({
        name: z.string().describe("skill 名（见系统提示词 Available Skills 列表）"),
      }),
    }
  );
}
