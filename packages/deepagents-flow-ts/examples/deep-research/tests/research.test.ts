/**
 * 深度研究报告 flow 测试。
 *  - 纯函数（无凭证、确定性）：routeAfterOutlineReview / routeAfterQualityReview / fanoutToResearch
 *    —— 守住双层 reflection 条件边 + MAX_* 封顶（防死循环）+ Send 扇出拓扑。
 *  - 真实接入（skipIf 无凭证）：plan / research / draft / outline_review / quality_review / finalize
 *    真调 LLM + duckduckgo 搜索 MCP，验证完整的多阶段 + 多轮 HITL 闭环。
 *  - 长任务持久化（无凭证）：clarify interrupt 跨 flow 实例（模拟重启）仍能 resume 续跑。
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import {
  createResearchFlow,
  routeAfterOutlineReview,
  routeAfterQualityReview,
  routeAfterConverse,
  isEndSignal,
  fanoutToResearch,
  outlineToPlanEntries,
  isDdgErrorText,
  mergeResearchSources,
  scoreResearchSource,
  normalizeOutlineSections,
  MAX_OUTLINE_REVIEW,
  MAX_DRAFT_REVIEW,
  type ResearchStateType,
} from "../graph.js";
import {
  artifactParentDir,
  markdownToHtml,
  writeDeliveryArtifacts,
} from "../nodes/delivery.js";
import { loadFlowConfig } from "../../../src/runtime/flow-config.js";
import { FileCheckpointSaver } from "../../../src/runtime/services/file-checkpoint-saver.js";

const hasCreds = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
  (k) => Boolean(process.env[k])
);
const runIntegration = process.env.RUN_INTEGRATION === "1" && hasCreds;

// 构造测试 state 的辅助
function makeState(over: Partial<ResearchStateType>): ResearchStateType {
  return {
    topic: "test",
    refinedTopic: "test",
    outline: [{ title: "S1", query: "q1" }],
    currentSection: { title: "S1", query: "q1" },
    findings: [],
    outlineDecision: "",
    outlineCritique: "",
    outlineAttempts: 0,
    draftDecision: "",
    draftCritique: "",
    draftAttempts: 0,
    draft: "",
    finalReport: "",
    feedback: "",
    conversation: [],
    userMessage: "",
    lastAnswer: "",
    artifactMarkdownPath: "",
    artifactHtmlPath: "",
    ...over,
  } as ResearchStateType;
}

describe("routeAfterOutlineReview (条件边, 纯函数, 无凭证)", () => {
  it("insufficient 且未达上限 → 回 plan 重规划", () => {
    const state = makeState({
      outlineDecision: "insufficient",
      outlineAttempts: 1,
    });
    expect(routeAfterOutlineReview(state)).toBe("plan");
  });

  it("insufficient 但已达 MAX_OUTLINE_REVIEW → 强制进 draft（防死循环）", () => {
    const state = makeState({
      outlineDecision: "insufficient",
      outlineAttempts: MAX_OUTLINE_REVIEW,
    });
    expect(routeAfterOutlineReview(state)).toBe("write_draft");
  });

  it("sufficient → 直接进 draft", () => {
    const state = makeState({
      outlineDecision: "sufficient",
      outlineAttempts: 1,
    });
    expect(routeAfterOutlineReview(state)).toBe("write_draft");
  });
});

describe("routeAfterQualityReview (条件边, 纯函数, 无凭证)", () => {
  it("fail 且未达上限 → 回 draft 重写", () => {
    const state = makeState({
      draftDecision: "fail",
      draftAttempts: 1,
    });
    expect(routeAfterQualityReview(state)).toBe("write_draft");
  });

  it("fail 但已达 MAX_DRAFT_REVIEW → 强制进 approve（防死循环）", () => {
    const state = makeState({
      draftDecision: "fail",
      draftAttempts: MAX_DRAFT_REVIEW,
    });
    expect(routeAfterQualityReview(state)).toBe("approve");
  });

  it("pass → 直接进 approve", () => {
    const state = makeState({
      draftDecision: "pass",
      draftAttempts: 1,
    });
    expect(routeAfterQualityReview(state)).toBe("approve");
  });
});

describe("routeAfterConverse / isEndSignal (持续会话路由, 纯函数, 无凭证)", () => {
  it("收尾信号（结束/ok/空）→ wrapup 定稿", () => {
    for (const msg of ["结束", "ok", "通过", "", "完成", "就这样"]) {
      expect(isEndSignal(msg)).toBe(true);
      expect(routeAfterConverse(makeState({ userMessage: msg }))).toBe("wrapup");
    }
  });

  it("继续追问/修改 → respond 持续会话", () => {
    for (const msg of ["把第二节展开", "deep agents 和 workflow 区别？", "再补充一个案例"]) {
      expect(isEndSignal(msg)).toBe(false);
      expect(routeAfterConverse(makeState({ userMessage: msg }))).toBe("respond");
    }
  });
});

describe("长任务持久化：clarify interrupt 跨实例续跑（无凭证，flagship 端到端）", () => {
  // clarify 是首节点、纯 interrupt（不调模型），故无凭证也能验证真实 deep-research 图的落盘续跑。
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("实例 A 跑到 clarify(主题确认) → 新实例 B(同目录)仍 hasStarted=true", async () => {
    const { appConfig } = loadFlowConfig();
    const dir = mkdtempSync(join(tmpdir(), "research-dur-"));
    dirs.push(dir);
    const tid = "research-long-1";

    const flowA = createResearchFlow(appConfig, {
      checkpointer: new FileCheckpointSaver({ dir }),
    });
    const r1 = await flowA.run({ query: "LangGraph 的架构与适用场景" }, tid);
    expect(r1.status).toBe("interrupted");
    if (r1.status === "interrupted") expect(r1.question).toContain("主题");

    // 模拟进程/IDE 重启：全新 flow 实例 + 全新 saver（同目录）
    const flowB = createResearchFlow(appConfig, {
      checkpointer: new FileCheckpointSaver({ dir }),
    });
    expect(await flowB.hasStarted!(tid)).toBe(true);
  });
});

describe("normalizeOutlineSections (大纲规范化, 纯函数, 无凭证)", () => {
  it("保留 libraryHint 并过滤空章节", () => {
    const out = normalizeOutlineSections([
      { title: " 架构 ", query: "langgraph architecture", libraryHint: " langgraph " },
      { title: "", query: "skip" },
      { title: "背景", query: "industry overview", libraryHint: "" },
    ]);
    expect(out).toEqual([
      { title: "架构", query: "langgraph architecture", libraryHint: "langgraph" },
      { title: "背景", query: "industry overview" },
    ]);
  });
});

describe("mergeResearchSources (双源取优, 纯函数, 无凭证)", () => {
  const c7Docs =
    "LangGraph StateGraph API. Use Annotation.Root for state. Version 1.4 supports Command routing.";
  const ddgFail =
    "（搜索失败：DDG detected an anomaly in the request, you are likely making requests too quickly.）";

  it("Context7 成功 + DDG 失败 → 以 Context7 为主源", () => {
    const merged = mergeResearchSources(
      [
        { source: "context7", text: c7Docs, ok: true, libraryId: "/langchain-ai/langgraph" },
        { source: "duckduckgo", text: ddgFail, ok: false },
      ],
      "langgraph StateGraph Command"
    );
    expect(merged).toContain("Context7");
    expect(merged).toContain("StateGraph");
    expect(merged).not.toContain("DDG detected");
  });

  it("两路成功 → 高分为主、次高分为补充", () => {
    const merged = mergeResearchSources(
      [
        {
          source: "duckduckgo",
          text: "Short web snippet about langgraph.",
          ok: true,
        },
        {
          source: "context7",
          text: c7Docs,
          ok: true,
          libraryId: "/langchain-ai/langgraph",
        },
      ],
      "langgraph StateGraph"
    );
    expect(merged).toContain("主源");
    expect(merged).toContain("Context7");
    expect(scoreResearchSource("context7", c7Docs, true, "langgraph StateGraph", {
      libraryId: "/langchain-ai/langgraph",
    })).toBeGreaterThan(
      scoreResearchSource("duckduckgo", "Short web snippet about langgraph.", true, "langgraph StateGraph")
    );
  });

  it("两路均失败 → 降级文案", () => {
    const merged = mergeResearchSources(
      [
        { source: "context7", text: "（Context7 检索失败：timeout）", ok: false },
        { source: "duckduckgo", text: ddgFail, ok: false },
      ],
      "langgraph"
    );
    expect(merged).toMatch(/检索失败|Context7|搜索失败/);
  });
});

describe("isDdgErrorText (DDG 限流正文检测, 纯函数, 无凭证)", () => {
  it("识别 DDG anomaly / too quickly 类错误正文", () => {
    expect(
      isDdgErrorText(
        "Error: DDG detected an anomaly in the request, you are likely making requests too quickly."
      )
    ).toBe(true);
    expect(isDdgErrorText("正常搜索结果 snippet")).toBe(false);
  });
});

describe("fanoutToResearch (Send 扇出, 纯函数, 无凭证)", () => {
  it("为每个 outline section 派一个 Send 实例", () => {
    const state = makeState({
      outline: [
        { title: "架构", query: "langgraph architecture" },
        { title: "场景", query: "langgraph use cases" },
        { title: "对比", query: "langgraph vs crewai" },
      ],
    });
    const sends = fanoutToResearch(state);
    expect(sends.length).toBe(3);
  });

  it("空大纲 → 零 Send", () => {
    const state = makeState({ outline: [] });
    const sends = fanoutToResearch(state);
    expect(sends.length).toBe(0);
  });
});

describe("outlineToPlanEntries (ACP Plan 映射, 纯函数, 无凭证)", () => {
  it("将 outline 映射为固定顺序的 ACP plan entries（含 libraryHint）", () => {
    const entries = outlineToPlanEntries(
      [
        { title: "背景", query: "background" },
        { title: "架构", query: "architecture", libraryHint: "langgraph" },
      ],
      { currentTitle: "架构", completedTitles: ["背景"] }
    );
    expect(entries).toEqual([
      { content: "背景（搜索：background）", priority: "medium", status: "completed" },
      {
        content: "架构（搜索：architecture；库：langgraph）",
        priority: "medium",
        status: "in_progress",
      },
    ]);
  });
});

describe("delivery artifacts (最终交付, 纯函数, 无凭证)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("生成 Markdown 与 HTML 文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "research-artifacts-"));
    dirs.push(dir);
    const artifacts = writeDeliveryArtifacts("# 标题\n\n- 要点", {
      topic: "测试 报告",
      outputDir: dir,
    });
    expect(existsSync(artifacts.markdownPath)).toBe(true);
    expect(existsSync(artifacts.htmlPath)).toBe(true);
    expect(readFileSync(artifacts.markdownPath, "utf-8")).toContain("# 标题");
    expect(readFileSync(artifacts.htmlPath, "utf-8")).toContain("<h1>标题</h1>");
    expect(artifactParentDir(artifacts.markdownPath)).toBe(dir);
  });

  it("Markdown HTML 包装会转义危险字符", () => {
    const html = markdownToHtml("# <script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe.skipIf(!runIntegration)(
  "deep-research flow (真实 LLM + MCP, 多阶段 + 多轮 HITL)",
  () => {
    const { appConfig } = loadFlowConfig();

    it(
      "首轮跑到 clarify interrupt：返回主题确认问题",
      async () => {
        // 单测注入 MemorySaver 保持无盘（生产默认 FileCheckpointSaver 跨重启续跑）
        const flow = createResearchFlow(appConfig, { checkpointer: new MemorySaver() });
        const res = await flow.run(
          { query: "LangGraph 的架构与适用场景" },
          randomUUID()
        );
        // 图首节点是 clarify（interrupt①），先确认/细化主题，再到大纲门
        expect(res.status).toBe("interrupted");
        if (res.status === "interrupted")
          expect(res.question).toContain("主题");
      },
      120000
    );

    it(
      "确认主题 → 确认大纲 → 报告 → 持续会话(追问1轮) → 结束定稿",
      async () => {
        const flow = createResearchFlow(appConfig, { checkpointer: new MemorySaver() });
        const tid = randomUUID();

        // interrupt①: 确认主题
        const r1 = await flow.run(
          { query: "TypeScript 在后端开发中的优势与挑战" },
          tid
        );
        expect(r1.status).toBe("interrupted");

        // resume① → interrupt②: 确认大纲
        const r2 = await flow.run({ resume: "ok" }, tid);
        expect(r2.status).toBe("interrupted");
        if (r2.status === "interrupted") expect(r2.question).toContain("大纲");

        // resume② → 并行调研 + 初稿 + 质量评审 → converse: 展示报告，进入持续会话
        const r3 = await flow.run({ resume: "ok" }, tid);
        expect(r3.status).toBe("interrupted");
        if (r3.status === "interrupted") expect(r3.question).toContain("报告");

        // 持续会话：追问一轮（复用同一研究上下文）→ 仍是 interrupted（回路不收场）
        const r4 = await flow.run({ resume: "再补充一段与 Go 的对比" }, tid);
        expect(r4.status).toBe("interrupted");

        // 回复「结束」→ delivery 节点问询保存目录
        const r5 = await flow.run({ resume: "结束" }, tid);
        expect(r5.status).toBe("interrupted");
        if (r5.status === "interrupted") expect(r5.question).toContain("保存目录");

        // 直接回车 → 使用默认会话 artifacts 目录并完成
        const r6 = await flow.run({ resume: "" }, tid);
        expect(r6.status).toBe("done");
        if (r6.status === "done") {
          expect(r6.answer).toContain("Markdown");
          expect(r6.answer).toContain("HTML");
        }
      },
      300000
    );
  }
);
