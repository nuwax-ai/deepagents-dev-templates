/** deep-research 节点共享类型。 */

export interface OutlineSection {
  title: string;
  /** 用于 DuckDuckGo / 通用检索的英文关键词。 */
  query: string;
  /**
   * Context7 resolve-library-id 的 libraryName 提示（如 langgraph、typescript）。
   * 非技术章节可省略；plan 节点由 LLM 按需填充。
   */
  libraryHint?: string;
}

export interface ResearchFinding {
  title: string;
  searchResult: string;
  summary: string;
}

/** 报告完成后的持续会话的一轮（用户问/助手答，共享同一研究上下文）。 */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** 最终交付产物路径。 */
export interface DeliveryArtifacts {
  markdownPath: string;
  htmlPath: string;
}

/**
 * 节点只依赖这份轻量 state 形状；真实 LangGraph Annotation state 在 graph.ts 里定义。
 * 保持结构化类型能让 nodes/ 与 graph.ts 解耦，避免拆文件后形成运行时循环依赖。
 */
export interface ResearchStateShape {
  topic: string;
  refinedTopic: string;
  outline: OutlineSection[];
  currentSection: OutlineSection;
  findings: ResearchFinding[];
  outlineDecision: string;
  outlineCritique: string;
  outlineAttempts: number;
  draftDecision: string;
  draftCritique: string;
  draftAttempts: number;
  draft: string;
  draftStreamed: boolean;
  finalReport: string;
  feedback: string;
  conversation: ConversationTurn[];
  userMessage: string;
  lastAnswer: string;
  lastAnswerStreamed: boolean;
  languageHint: string;
  artifactMarkdownPath: string;
  artifactHtmlPath: string;
}
