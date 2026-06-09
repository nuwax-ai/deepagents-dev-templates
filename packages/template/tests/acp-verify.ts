/**
 * ACP 功能验证脚本
 * 逐项验证 TC-01 ~ TC-06，输出详细日志
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const PASS = "\x1b[32m✓ PASS\x1b[0m";
const FAIL = "\x1b[31m✗ FAIL\x1b[0m";
const INFO = "\x1b[36m→\x1b[0m";

// 修正：用 template 目录作为 cwd（与 Zed 打开 packages/template/ 一致）
const TEMPLATE_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// Load .env explicitly to get the correct API endpoint (override shell env)
loadDotenv({ path: resolve(TEMPLATE_DIR, ".env"), override: true });

let sessionId: string | undefined;
const testResults: { name: string; pass: boolean; detail: string }[] = [];

class VerifyClient implements Client {
  updates: SessionNotification[] = [];
  permissions: RequestPermissionRequest[] = [];
  autoApprove = false;
  allowAlwaysOnce = false;
  debug = true;

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.updates.push(params);
    const u = params.update as any;
    // 调试：打印所有 update 类型
    const updateType = u.sessionUpdate ?? u.type ?? "unknown";
    if (this.debug) {
      const preview = JSON.stringify(u).slice(0, 200);
      console.log(`  [update] ${updateType}: ${preview}`);
    }
    if (updateType === "message_delta") {
      const text = u.content?.map?.((c: any) => c.text ?? c.content ?? "").join("") ?? "";
      if (text) process.stdout.write(text);
    }
    if (updateType === "message_complete") {
      process.stdout.write("\n");
    }
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    this.permissions.push(params);
    console.log(`  ${INFO} Permission requested: ${JSON.stringify(params, null, 2)}`);
    // allowAlwaysOnce: 返回 allow-always 选项（用于测试缓存）
    if (this.allowAlwaysOnce) {
      this.allowAlwaysOnce = false;
      return { outcome: { outcome: "selected", optionId: "allow-always" } };
    }
    return {
      outcome: this.autoApprove
        ? { outcome: "selected", optionId: "allow-once" }
        : { outcome: "selected", optionId: "reject" },
    };
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    // 服务端已将路径转为绝对路径，直接使用
    const fullPath = params.path.startsWith("/") && params.path.includes(TEMPLATE_DIR)
      ? params.path
      : resolve(TEMPLATE_DIR, params.path.startsWith("/") ? params.path.slice(1) : params.path);
    console.log(`  ${INFO} readTextFile: ${params.path} → ${fullPath}`);
    try {
      const content = readFileSync(fullPath, "utf-8");
      return { content };
    } catch {
      return { content: "" };
    }
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    // 服务端已将路径转为绝对路径，直接使用
    const fullPath = params.path.startsWith("/") && params.path.includes(TEMPLATE_DIR)
      ? params.path
      : resolve(TEMPLATE_DIR, params.path.startsWith("/") ? params.path.slice(1) : params.path);
    console.log(`  ${INFO} writeTextFile: ${params.path} → ${fullPath}`);
    try {
      writeFileSync(fullPath, params.content ?? "", "utf-8");
    } catch (err) {
      console.log(`  ${INFO} writeTextFile error: ${err}`);
    }
    return {};
  }
}

function startServer(): ChildProcessWithoutNullStreams {
  const templateDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error(`Unsupported LLM_PROVIDER: ${provider} (expected "anthropic" or "openai")`);
  }

  // Build provider-specific env. We always clear the OTHER provider's keys so
  // helper.ts' fallback resolution in resolveModel()/resolveSummarizerModel()
  // can't accidentally pick up stale credentials.
  const providerEnv: Record<string, string> = provider === "openai"
    ? {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
        OPENAI_MODEL: process.env.OPENAI_MODEL || "",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_BASE_URL: "",
        ANTHROPIC_MODEL: "",
      }
    : {
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || "",
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "https://api.deepseek.com/anthropic",
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "deepseek-v4-pro",
        OPENAI_API_KEY: "",
        OPENAI_BASE_URL: "",
        OPENAI_MODEL: "",
      };

  console.log(`  ${INFO} Provider: ${provider}`);
  if (provider === "openai") {
    console.log(`  ${INFO} Spawning server with OPENAI_BASE_URL: ${providerEnv.OPENAI_BASE_URL || "not set"}`);
    console.log(`  ${INFO} Spawning server with OPENAI_API_KEY: ${providerEnv.OPENAI_API_KEY ? "set (" + providerEnv.OPENAI_API_KEY.slice(-4) + ")" : "not set"}`);
    console.log(`  ${INFO} Spawning server with OPENAI_MODEL: ${providerEnv.OPENAI_MODEL || "not set"}`);
  } else {
    console.log(`  ${INFO} Spawning server with ANTHROPIC_BASE_URL: ${providerEnv.ANTHROPIC_BASE_URL || "not set"}`);
    console.log(`  ${INFO} Spawning server with ANTHROPIC_AUTH_TOKEN: ${providerEnv.ANTHROPIC_AUTH_TOKEN ? "set (" + providerEnv.ANTHROPIC_AUTH_TOKEN.slice(-4) + ")" : "not set"}`);
  }

  return spawn("node", ["--max-old-space-size=4096", "--import", "tsx", "src/index.ts", "--config", "./config/app-agent.config.json"], {
    cwd: templateDir,
    env: {
      ...process.env,
      ...providerEnv,
      LLM_PROVIDER: provider,
      LOG_LEVEL: "debug",
      // Override permissions mode for testing HITL
      DEEPAGENTS_PERMISSIONS_MODE: "ask",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function record(name: string, pass: boolean, detail: string) {
  testResults.push({ name, pass, detail });
  console.log(`  ${pass ? PASS : FAIL} ${name}: ${detail}`);
}

async function run() {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  ACP 功能验证 — Zed 集成测试");
  console.log("═══════════════════════════════════════════════\n");

  const child = startServer();
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8");
  });

  const client = new VerifyClient();
  const connection = new ClientSideConnection(
    () => client,
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
  );

  try {
    // ─── TC-01: ACP 连接建立 ───
    console.log("── TC-01: ACP 连接建立 ──");
    const init = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "acp-verify", version: "0.1.0" },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });

    const agentName = init.agentInfo?.name;
    const hasLoadSession = init.agentCapabilities?.loadSession;
    const hasCommands = init.agentCapabilities?.sessionCapabilities?.commands;

    record("agentInfo.name", agentName === "my-scenario-agent", `got "${agentName}"`);
    record("loadSession capability", hasLoadSession === true, `got ${hasLoadSession}`);
    record("commands capability", hasCommands === true, `got ${hasCommands}`);

    // ─── TC-02: 新建会话 ───
    console.log("\n── TC-02: 新建会话 ──");
    client.updates = [];
    const session = await connection.newSession({
      cwd: TEMPLATE_DIR,
      mcpServers: [],
    });

    sessionId = session.sessionId;
    record("sessionId format", /^sess_/.test(session.sessionId), `got "${session.sessionId}"`);
    record("default mode", session.modes?.currentModeId === "agent", `got "${session.modes?.currentModeId}"`);

    const hasCommandsUpdate = client.updates.some(
      (u) => u.update.sessionUpdate === "available_commands_update"
    );
    record("available_commands_update", hasCommandsUpdate, `received: ${hasCommandsUpdate}`);

    // ─── TC-03: 基本对话 ───
    console.log("\n── TC-03: 基本对话 ──");
    console.log(`  ${INFO} 发送: "回复 hello world，不要说其他内容"`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "回复 hello world，不要说其他内容" }],
    });

    const textUpdates = client.updates.filter(
      (u: any) => u.update.sessionUpdate === "agent_message_chunk"
    );
    const responseText = textUpdates
      .map((u: any) => u.update.content?.text ?? "")
      .join("");
    record("收到文本响应", textUpdates.length > 0, `got ${textUpdates.length} chunks, text: "${responseText}"`);
    record("响应包含 hello", responseText.toLowerCase().includes("hello"), `text: "${responseText}"`);

    // ─── TC-04: 文件读取 ───
    console.log("\n── TC-04: 文件读取工具 ──");
    console.log(`  ${INFO} 发送: "读取 package.json 并告诉我 name 字段的值，只输出值"`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "读取 package.json 并告诉我 name 字段的值，只输出值" }],
    });

    const readUpdates = client.updates.filter(
      (u: any) => u.update.sessionUpdate === "tool_call"
    );
    const allText = client.updates
      .filter((u: any) => u.update.sessionUpdate === "agent_message_chunk")
      .map((u: any) => u.update.content?.text ?? "")
      .join("");
    // invoke 模式下不发出 tool_call 通知，只检查结果
    record("返回项目名称", allText.includes("deepagents-dev-templates"), `response: "${allText.slice(0, 150)}"`);

    // ─── TC-05: 文件写入 ───
    // Note: HITL is disabled in ACP mode (deepagents-acp doesn't handle LangGraph interrupts)
    console.log("\n── TC-05: 文件写入 ──");
    console.log(`  ${INFO} 发送: "创建文件 acp-verify-test.txt，内容为 ACP_OK"`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "创建文件 acp-verify-test.txt，内容为 ACP_OK。直接调用工具，不要问问题。" }],
    });

    const filePath = resolve(TEMPLATE_DIR, "acp-verify-test.txt");
    const fileCreated = existsSync(filePath);
    let fileContent = "";
    if (fileCreated) {
      fileContent = readFileSync(filePath, "utf-8").trim();
      unlinkSync(filePath);
    }
    record("文件已创建", fileCreated && fileContent === "ACP_OK", `content: "${fileContent}"`);

    // ─── TC-15: 文件写入验证 ───
    console.log("\n── TC-15: 文件写入验证 ──");
    console.log(`  ${INFO} 发送: "创建文件 acp-verify-approved.txt，内容为 APPROVED"`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "创建文件 acp-verify-approved.txt，内容为 APPROVED。直接调用工具，不要问问题。" }],
    });

    const approvedPath = resolve(TEMPLATE_DIR, "acp-verify-approved.txt");
    const approvedExists = existsSync(approvedPath);
    let approvedContent = "";
    if (approvedExists) {
      approvedContent = readFileSync(approvedPath, "utf-8").trim();
      unlinkSync(approvedPath);
    }
    record("文件已创建", approvedExists && approvedContent === "APPROVED", `content: "${approvedContent}"`);

    // ─── TC-15b: 连续文件写入验证 ───
    console.log("\n── TC-15b: 连续文件写入验证 ──");
    console.log(`  ${INFO} 第一次: 创建 acp-always-test.txt`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "创建文件 acp-always-test.txt，内容为 FIRST。直接调用工具，不要问问题。" }],
    });

    const alwaysPath = resolve(TEMPLATE_DIR, "acp-always-test.txt");
    const firstExists = existsSync(alwaysPath);
    let firstContent = "";
    if (firstExists) {
      firstContent = readFileSync(alwaysPath, "utf-8").trim();
      unlinkSync(alwaysPath);
    }
    record("第一次: 文件已创建", firstExists && firstContent === "FIRST", `content: "${firstContent}"`);

    console.log(`  ${INFO} 第二次: 创建 acp-always-test2.txt`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "创建文件 acp-always-test2.txt，内容为 SECOND。直接调用工具，不要问问题。" }],
    });

    const alwaysPath2 = resolve(TEMPLATE_DIR, "acp-always-test2.txt");
    const secondExists = existsSync(alwaysPath2);
    let secondContent = "";
    if (secondExists) {
      secondContent = readFileSync(alwaysPath2, "utf-8").trim();
      unlinkSync(alwaysPath2);
    }
    record("第二次: 文件已创建", secondExists && secondContent === "SECOND", `content: "${secondContent}"`);

    // ─── TC-06: 文件编辑工具 ───
    // Note: edit_file requires write permission, autoApprove must be true
    console.log("\n── TC-06: 文件编辑工具 ──");
    const editTestPath = resolve(TEMPLATE_DIR, "acp-edit-test.txt");
    writeFileSync(editTestPath, "original content\nline 2\nline 3", "utf-8");
    console.log(`  ${INFO} 发送: "把 acp-edit-test.txt 的第一行改为 edited content"`);
    client.updates = [];
    client.autoApprove = true; // Ensure permission is granted for edit_file
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: '使用 edit_file 工具把 acp-edit-test.txt 的第一行改为 "edited content"。old_string 是 "original content"，new_string 是 "edited content"。直接调用工具，不要问问题。' }],
    });

    const editedContent = existsSync(editTestPath) ? readFileSync(editTestPath, "utf-8") : "";
    const editSuccess = editedContent.includes("edited content");
    record("编辑成功", editSuccess, `content: "${editedContent.slice(0, 100)}"`);
    if (existsSync(editTestPath)) unlinkSync(editTestPath);

    // ─── TC-12: 多轮对话上下文保持 ───
    console.log("\n── TC-12: 多轮对话上下文保持 ──");
    console.log(`  ${INFO} 第一轮: "我叫小明"`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "记住我叫小明" }],
    });

    console.log(`  ${INFO} 第二轮: "我刚才说我叫什么？"`);
    client.updates = [];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "我刚才说我叫什么？只回答名字。" }],
    });

    const contextResponse = client.updates
      .filter((u: any) => u.update.sessionUpdate === "agent_message_chunk")
      .map((u: any) => u.update.content?.text ?? "")
      .join("");
    record("上下文保持", contextResponse.toLowerCase().includes("小明"), `response: "${contextResponse.slice(0, 100)}"`);

    // ─── TC-13: 会话取消 ───
    console.log("\n── TC-13: 会话取消 ──");
    console.log(`  ${INFO} 发送复杂任务然后取消`);
    client.updates = [];
    // 发起一个可能需要多步的任务
    const cancelPromise = connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "列出当前目录下所有文件，逐个分析它们的内容" }],
    });

    // 短暂等待后取消
    await new Promise((r) => setTimeout(r, 500));
    try {
      await connection.cancel({ sessionId: session.sessionId });
      record("取消请求成功", true, "cancel sent");
    } catch {
      record("取消请求成功", false, "cancel failed");
    }
    try {
      await cancelPromise;
    } catch {
      // cancel 可能导致 prompt 失败，这是预期的
    }

    // ─── TC-14: Stale Session 恢复 ───
    console.log("\n── TC-14: Stale Session 恢复 ──");
    console.log(`  ${INFO} 使用旧 session ID 发送消息`);
    const oldSessionId = session.sessionId;
    // 模拟 stale session：直接用这个 ID 在新连接上发送
    // 实际上当前连接仍然有效，这里测试的是服务端是否能处理
    client.updates = [];
    await connection.prompt({
      sessionId: oldSessionId,
      prompt: [{ type: "text", text: "hello" }],
    });
    const staleResponse = client.updates.some(
      (u: any) => u.update.sessionUpdate === "agent_message_chunk"
    );
    record("Stale session 响应", staleResponse, `got response: ${staleResponse}`);

    // ─── TC-16: 被保护路径拒绝写入 ───
    console.log("\n── TC-16: 被保护路径拒绝写入 ──");
    console.log(`  ${INFO} 发送: "修改 src/surfaces/acp/server.ts 的第一行为注释"`);
    client.updates = [];
    client.permissions = [];
    client.autoApprove = true; // 即使批准，权限系统也应拒绝
    const originalFirstLine = readFileSync(resolve(TEMPLATE_DIR, "src/surfaces/acp/server.ts"), "utf-8").split("\n")[0];
    await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "修改 src/surfaces/acp/server.ts 的第一行为 // TEST COMMENT。直接调用工具，不要问问题。" }],
    });

    const afterFirstLine = readFileSync(resolve(TEMPLATE_DIR, "src/surfaces/acp/server.ts"), "utf-8").split("\n")[0];
    const protectedNotModified = afterFirstLine === originalFirstLine;
    record("保护路径未被修改", protectedNotModified, `first line: "${afterFirstLine}"`);

  } catch (err) {
    console.error(`\n${FAIL} Fatal error:`, err);
  } finally {
    child.kill();

    // ─── 汇总 ───
    console.log("\n═══════════════════════════════════════════════");
    console.log("  验证结果汇总");
    console.log("═══════════════════════════════════════════════");
    const passed = testResults.filter((r) => r.pass).length;
    const failed = testResults.filter((r) => !r.pass).length;
    for (const r of testResults) {
      console.log(`  ${r.pass ? PASS : FAIL} ${r.name}: ${r.detail}`);
    }
    console.log(`\n  总计: ${passed} 通过, ${failed} 失败\n`);

    // 输出 stderr 日志片段
    if (stderr) {
      console.log("── 服务端日志（stderr 摘要）──");
      const lines = stderr.split("\n").filter((l) => l.trim());
      // 只输出关键行
      const keyLines = lines.filter(
        (l) =>
          l.includes("bootstrap") ||
          l.includes("session") ||
          l.includes("Session") ||
          l.includes("prompt") ||
          l.includes("tool") ||
          l.includes("permission") ||
          l.includes("lifecycle") ||
          l.includes("config") ||
          l.includes("START") ||
          l.includes("ERROR") ||
          l.includes("WARN")
      );
      for (const line of keyLines.slice(-30)) {
        console.log(`  ${line}`);
      }
    }
  }
}

run().catch(console.error);
