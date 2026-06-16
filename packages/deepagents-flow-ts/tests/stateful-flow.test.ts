/**
 * createStatefulFlow 长任务基座单测 —— 确定性、无凭证（不调模型）。
 *
 * 守住「全面长任务硬化」的核心契约：
 *  1. run-loop：interrupt 暂停返回 question；resume 跑到底返回 toResult(answer)。
 *  2. hasStarted 来自 checkpointer（是否已有 checkpoint）：**一个会话一个主题**——
 *     首条开题(false)，之后 interrupt/出错/已完成都 true → 续跑，绝不重头开新主题。
 *  3. **跨实例/重启续跑**：FileCheckpointSaver 落盘 → 新建一个 flow 实例（模拟进程重启，
 *     内存全新）仍能 hasStarted=true 并正确 resume。
 *  4. 对照：MemorySaver 新实例认不得旧会话 —— 这正是迁移前 4 个示例的问题。
 */

import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  StateGraph,
  START,
  END,
  Annotation,
  Send,
  INTERRUPT,
  interrupt,
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { createStatefulFlow } from "../src/surfaces/stateful-flow.js";
import { FileCheckpointSaver } from "../src/runtime/file-checkpoint-saver.js";

// ── 玩具图：ask(interrupt 暂停) → finish(定稿) ──────────────
const ToyState = Annotation.Root({
  query: Annotation<string>,
  reply: Annotation<string>,
  output: Annotation<string>,
});
type ToyStateType = typeof ToyState.State;

function buildToyGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(ToyState)
    .addNode("ask", () => {
      const fb = interrupt({ question: "确认吗？" });
      return { reply: String(fb ?? "") };
    })
    .addNode("finish", (s: ToyStateType) => ({ output: `done:${s.reply}` }))
    .addEdge(START, "ask")
    .addEdge("ask", "finish")
    .addEdge("finish", END)
    .compile({ checkpointer });
}

const makeFlow = (cp: BaseCheckpointSaver) =>
  createStatefulFlow<ToyStateType>({
    buildGraph: (saver) => buildToyGraph(saver),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
    checkpointer: cp,
  });

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "flow-dur-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("createStatefulFlow run-loop（无凭证，确定性）", () => {
  it("interrupt → 返回 question；resume → done + toResult", async () => {
    const flow = makeFlow(new MemorySaver());
    const tid = randomUUID();

    const r1 = await flow.run({ query: "hi" }, tid);
    expect(r1.status).toBe("interrupted");
    if (r1.status === "interrupted") expect(r1.question).toBe("确认吗？");

    const r2 = await flow.run({ resume: "ok" }, tid);
    expect(r2.status).toBe("done");
    if (r2.status === "done") expect(r2.answer).toBe("done:ok");
  });

  it("hasStarted：全新 false；interrupt 后 true；done 后仍 true（一个会话一个主题）", async () => {
    const flow = makeFlow(new MemorySaver());
    const tid = randomUUID();
    expect(await flow.hasStarted!(randomUUID())).toBe(false); // 全新会话 → 首条开题

    await flow.run({ query: "hi" }, tid);
    expect(await flow.hasStarted!(tid)).toBe(true); // 停在 interrupt → 续跑

    await flow.run({ resume: "ok" }, tid);
    // 关键：已完成的会话 hasStarted 仍 true → 之后的消息续跑同一项目，不会被当成新主题重头开始
    expect(await flow.hasStarted!(tid)).toBe(true);
  });

  it("已完成会话再收消息 → 续跑（返回原结果），不重起新主题", async () => {
    const flow = makeFlow(new MemorySaver());
    const tid = randomUUID();
    await flow.run({ query: "hi" }, tid);
    await flow.run({ resume: "ok" }, tid); // → done: "done:ok"

    // surface 据 hasStarted=true 把这条也当 resume；done 图上 Command(resume) 是 no-op
    const again = await flow.run({ resume: "另一个话题" }, tid);
    expect(again.status).toBe("done");
    if (again.status === "done") expect(again.answer).toBe("done:ok"); // 不是 "done:另一个话题"
  });

  it("多模式 stream → 分发 text/stage/plan/tool/interrupt callbacks", async () => {
    const events: string[] = [];
    const fakeGraph = {
      async stream() {
        async function* gen() {
          yield ["custom", { type: "plan", entries: [{ content: "A", status: "pending" }] }];
          yield ["custom", { type: "stage", stage: "调研", detail: "A" }];
          yield ["tools", { event: "on_tool_start", toolCallId: "t1", name: "search", input: "{\"q\":\"x\"}" }];
          yield ["tools", { event: "on_tool_end", toolCallId: "t1", output: { kwargs: { content: "ok", status: "success" } } }];
          yield ["messages", [{ content: "hello" }, { langgraph_node: "respond" }]];
          yield ["updates", { wait: { [INTERRUPT]: [{ value: { question: "继续？" } }] } }];
        }
        return gen();
      },
      async getState() {
        return { values: { output: "done" }, config: { configurable: { checkpoint_id: "cp" } } };
      },
    };
    const flow = createStatefulFlow<{ output: string }>({
      buildGraph: () => fakeGraph,
      toInput: (query) => ({ query }),
      toResult: (v) => ({ answer: v.output }),
      checkpointer: new MemorySaver(),
    });

    const res = await flow.run({ query: "hi" }, "tid", {
      onPlan: (e) => events.push(`plan:${e.entries.length}`),
      onStage: (e) => events.push(`stage:${e.stage}:${e.detail}`),
      onToolCall: (e) => events.push(`tool:${e.status}:${e.toolName}`),
      onToken: (t) => events.push(`text:${t}`),
    });

    expect(res).toEqual({ status: "interrupted", question: "继续？" });
    expect(events).toEqual([
      "plan:1",
      "stage:调研:A",
      "tool:in_progress:search",
      "tool:completed:t1",
      "text:hello",
    ]);
  });
});

describe("长任务持久化：跨实例/重启续跑（FileCheckpointSaver）", () => {
  it("新建 flow 实例（模拟重启）仍 hasStarted=true 并能 resume 到底", async () => {
    const dir = freshDir();
    const tid = "long-task-1";

    // 实例 A：跑到 interrupt
    const flowA = makeFlow(new FileCheckpointSaver({ dir }));
    const r1 = await flowA.run({ query: "hi" }, tid);
    expect(r1.status).toBe("interrupted");

    // 实例 B：全新对象 + 全新 saver（同目录）= 进程/IDE 重启后的状态
    const flowB = makeFlow(new FileCheckpointSaver({ dir }));
    expect(await flowB.hasStarted!(tid)).toBe(true); // ← 从磁盘恢复了暂停点

    const r2 = await flowB.run({ resume: "go" }, tid);
    expect(r2.status).toBe("done");
    if (r2.status === "done") expect(r2.answer).toBe("done:go");
    expect(await flowB.hasStarted!(tid)).toBe(true); // 完成后仍属同一会话/项目
  });

  it("对照：MemorySaver 新实例认不得旧 interrupt（迁移前的问题）", async () => {
    const tid = randomUUID();
    const flowA = makeFlow(new MemorySaver());
    expect((await flowA.run({ query: "x" }, tid)).status).toBe("interrupted");
    expect(await flowA.hasStarted!(tid)).toBe(true);

    const flowB = makeFlow(new MemorySaver()); // 新「进程」内存
    expect(await flowB.hasStarted!(tid)).toBe(false); // ← 状态丢了
  });
});

// ── 持续会话回路：同一节点反复 interrupt（贴近 deep-research 的 converse↔respond）──
const ChatState = Annotation.Root({
  topic: Annotation<string>,
  msg: Annotation<string>,
  turns: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  out: Annotation<string>,
});
type ChatStateType = typeof ChatState.State;

function buildChatGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(ChatState)
    .addNode("chat", (s: ChatStateType) => {
      const reply = interrupt({ question: `[${s.turns.length}] 还需要什么？` });
      return { msg: String(reply ?? ""), turns: [`u:${String(reply ?? "")}`] };
    })
    .addNode("respond", (s: ChatStateType) => ({ turns: [`a:re(${s.msg})`] }))
    .addNode("wrapup", (s: ChatStateType) => ({ out: `done(${s.turns.length}轮)` }))
    .addEdge(START, "chat")
    .addConditionalEdges(
      "chat",
      (s: ChatStateType) => (s.msg === "结束" ? "wrapup" : "respond"),
      { respond: "respond", wrapup: "wrapup" }
    )
    .addEdge("respond", "chat") // 回应后回到 chat 继续（持续会话回路）
    .addEdge("wrapup", END)
    .compile({ checkpointer });
}

describe("持续会话：同一节点多轮 interrupt + 跨重启续跑", () => {
  it("多轮追问都续跑同一会话，「结束」才 done（中途换实例仍续上）", async () => {
    const dir = freshDir();
    const tid = "chat-1";
    const mk = () =>
      createStatefulFlow<ChatStateType>({
        buildGraph: (cp) => buildChatGraph(cp),
        toInput: (topic) => ({ topic }),
        toResult: (v) => ({ answer: v.out ?? "" }),
        checkpointer: new FileCheckpointSaver({ dir }),
      });

    const a = mk();
    expect((await a.run({ query: "deep agents" }, tid)).status).toBe("interrupted"); // chat#0
    const t1 = await a.run({ resume: "展开第二节" }, tid);
    expect(t1.status).toBe("interrupted"); // respond → chat#1（回路不收场）

    // 换新实例（模拟重启）继续同一会话
    const b = mk();
    expect(await b.hasStarted!(tid)).toBe(true);
    const t2 = await b.run({ resume: "再问个问题" }, tid);
    expect(t2.status).toBe("interrupted"); // chat#2

    const done = await b.run({ resume: "结束" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") expect(done.answer).toContain("done(");
  });
});

// ── 节点抛错后续跑（Send 扇出，贴近 deep-research 结构）——用户报的「中断后重头开始」回归 ──
const FanState = Annotation.Root({
  topic: Annotation<string>,
  items: Annotation<string[]>,
  findings: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  out: Annotation<string>,
});
type FanStateType = typeof FanState.State;

/**
 * research 扇出全部成功；review 第一次抛错、第二次成功 —— 精确复刻用户场景
 * （deep-research 的 outline_review 在并行 research 之后抛错）。fail 只炸一次。
 */
function buildFanGraph(checkpointer: BaseCheckpointSaver, fail: { v: boolean }) {
  return new StateGraph(FanState)
    .addNode("clarify", (s: FanStateType) => {
      const fb = interrupt({ question: `主题=${s.topic}` });
      return { topic: `${s.topic}/${String(fb)}`, items: ["a", "b", "c"] };
    })
    .addNode("research", (s: FanStateType) => ({
      findings: [`done:${(s as { item?: string }).item ?? "?"}`],
    }))
    .addNode("review", (s: FanStateType) => {
      if (fail.v) {
        fail.v = false; // 只炸一次（模拟评审时的限流/抖动）
        throw new Error("review BOOM (transient)");
      }
      return { out: `report(${s.findings.length})` };
    })
    .addEdge(START, "clarify")
    .addConditionalEdges(
      "clarify",
      (s: FanStateType) => s.items.map((item) => new Send("research", { ...s, item })),
      ["research"]
    )
    .addEdge("research", "review")
    .addEdge("review", END)
    .compile({ checkpointer });
}

const makeFanFlow = (cp: BaseCheckpointSaver, fail: { v: boolean }) =>
  createStatefulFlow<FanStateType>({
    buildGraph: (saver) => buildFanGraph(saver, fail),
    toInput: (topic) => ({ topic }),
    toResult: (v) => ({ answer: v.out ?? "" }),
    checkpointer: cp,
  });

describe("长任务韧性：节点抛错 → 续跑不重头（回归用户 bug）", () => {
  it("review 抛错后，新实例(同目录)仍 hasStarted=true，resume 续跑到底", async () => {
    const dir = freshDir();
    const tid = "fan-1";
    const fail = { v: true };

    const flowA = makeFanFlow(new FileCheckpointSaver({ dir }), fail);
    expect((await flowA.run({ query: "deep agents" }, tid)).status).toBe("interrupted");
    // resume → 并行 research 全成功 → review 抛错 → run 抛出（surface 会 catch 并提示）
    await expect(flowA.run({ resume: "ok" }, tid)).rejects.toThrow(/BOOM/);

    // 模拟进程重启：错误没把任务清掉 —— 断点仍在
    const flowB = makeFanFlow(new FileCheckpointSaver({ dir }), fail);
    expect(await flowB.hasStarted!(tid)).toBe(true); // ← 不再「重头开始」

    // 用户「继续」：从断点重跑失败节点 → 这次成功 → 到底
    const done = await flowB.run({ resume: "继续" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") expect(done.answer).toContain("report(");
    expect(await flowB.hasStarted!(tid)).toBe(true); // 完成后仍属同一会话/项目
  });
});
