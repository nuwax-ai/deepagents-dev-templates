/** Send 扇出：为每个 outline section 派一个 research 子图实例。框架 createFanout。 */

import { createFanout } from "../../../nodes/index.js";
import type { OutlineSection, ResearchStateShape } from "./types.js";

/**
 * fanoutToResearch — outline_gate Command.goto 与单测共用。
 * 框架 createFanout：outline 每个 section → 一个 Send("research", {当前章节+上下文})。
 */
export const fanoutToResearch = createFanout<OutlineSection, ResearchStateShape>({
  items: (s) => s.outline,
  target: "research",
  input: (section, s) => ({
    currentSection: section,
    outline: s.outline,
    refinedTopic: s.refinedTopic,
    languageHint: s.languageHint,
  }),
});
