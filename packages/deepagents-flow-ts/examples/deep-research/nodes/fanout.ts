/** Send 扇出：为每个 outline section 派一个 research 子图实例。 */

import { Send } from "@langchain/langgraph";
import type { ResearchStateShape } from "./types.js";

/**
 * fanoutToResearch — outline_gate Command.goto 与单测共用。
 */
export function fanoutToResearch(state: ResearchStateShape): Send[] {
  return state.outline.map(
    (section) =>
      new Send("research", {
        currentSection: section,
        outline: state.outline,
        refinedTopic: state.refinedTopic,
        languageHint: state.languageHint,
      })
  );
}
