/**
 * 旅行规划 flow 测试。
 *  - 纯函数（无凭证、确定性）：gather 解析 / fanout 扇出 —— 守住 map-reduce 的图拓扑。
 *  - 真实接入（skipIf 无凭证）：DuckDuckGo MCP 搜索 + LLM 整理 + HITL interrupt/resume 闭环。
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createTravelFlow,
  gatherNode,
  fanoutToResearch,
  type TravelStateType,
} from "../graph.js";
import { loadFlowConfig } from "../../../src/runtime/config.js";
import type { ToolCallEvent } from "../../../src/surfaces/flow-types.js";

const hasCreds = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
  (k) => Boolean(process.env[k])
);

const st = (o: Partial<TravelStateType>): TravelStateType => ({
  query: "",
  destination: "",
  days: 0,
  currentAspect: "",
  findings: [],
  itinerary: "",
  feedback: "",
  output: "",
  ...o,
});

describe("travel gather / fanout (纯函数, 无凭证)", () => {
  it("gather 解析目的地 + 天数", () => {
    const r = gatherNode(st({ query: "东京 3 天 美食优先" }));
    expect(r.destination).toBe("东京");
    expect(r.days).toBe(3);
  });

  it("gather 无天数 → 默认 3 天", () => {
    expect(gatherNode(st({ query: "巴黎" })).days).toBe(3);
  });

  it("fanout 扇出 4 个 research 实例（map）", () => {
    const sends = fanoutToResearch(st({ destination: "东京", days: 3 }));
    expect(sends).toHaveLength(4);
    for (const s of sends) expect(s.node).toBe("research");
    const aspects = sends.map(
      (s) => (s.args as { currentAspect: string }).currentAspect
    );
    expect(new Set(aspects)).toEqual(
      new Set(["transport", "stay", "sights", "food"])
    );
  });
});

// 真实接入：免 key 的 DuckDuckGo MCP 网络搜索 + LLM 整理。需凭证 + 网络。
describe.skipIf(!hasCreds)(
  "travel-planner flow (真实 MCP 搜索 + LLM, map-reduce + HITL)",
  () => {
    const { appConfig } = loadFlowConfig();

    it("并行 research 4 路 → 聚合 → interrupt 出行程", async () => {
      const flow = createTravelFlow(appConfig);
      const events: ToolCallEvent[] = [];
      const res = await flow.run({ query: "东京 3 天 美食优先" }, randomUUID(), {
        onToolCall: (e) => {
          events.push(e);
        },
      });

      expect(res.status).toBe("interrupted");
      if (res.status === "interrupted") expect(res.question).toContain("东京");

      // map-reduce：4 个 aspect 各发一次搜索（onToolCall 并发，每个工具一进一出）。
      expect(events.filter((e) => e.status === "in_progress")).toHaveLength(4);
      expect(
        events.filter((e) => e.status === "completed" || e.status === "failed")
      ).toHaveLength(4);
    }, 60000);

    it("resume 'ok' → 确认定稿（同一 threadId 续接草稿）", async () => {
      const flow = createTravelFlow(appConfig);
      const tid = randomUUID();
      const first = await flow.run({ query: "巴黎 5 天" }, tid);
      expect(first.status).toBe("interrupted");
      const done = await flow.run({ resume: "ok" }, tid);
      expect(done.status).toBe("done");
      if (done.status === "done") expect(done.answer).toContain("已确认");
    }, 60000);
  }
);
