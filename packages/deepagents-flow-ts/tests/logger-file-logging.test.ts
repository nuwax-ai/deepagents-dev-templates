/**
 * 文件日志在 LOG_DIR 不可用时不得阻塞 agent —— 回归（平台反馈：`ACP InitializeRequest timeout`）。
 *
 * 根因：旧实现在主线程同步 `mkdirSync(LOG_DIR, { recursive: true })`，上级目录失效时触发 Node 递归
 * mkdir 的无界重试（nodejs/node#66268），ACP 服务在那之后才启动。对应交接文档的验收点：
 *   - LOG_DIR 正常时行为不变（启动期日志 → PID 文件 → 并入会话文件，保序）
 *   - 上级目录失效：不递归、mkdir 调用次数有界，初始化结果为「已停用」，stderr 只报一次
 *   - 文件系统卡住：事件循环不被阻塞，超时后停用
 *   - 文件日志停用后 ACP 仍能应答 initialize
 *   - 运行中写入失败只报一次；「打完日志立刻退出」时未提交的行由 exit 兜底补写
 *
 * logger 是进程级单例状态，每个用例用 vi.resetModules() 取全新实例。
 */

import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";

/**
 * fs/promises.mkdir 探针：默认透传真实实现；各用例按需替换，模拟「上级目录失效」「文件系统卡住」。
 * 同时记录每次调用的 options，用于断言从未使用 recursive。
 * 用 vi.hoisted + 可变对象：vi.resetModules() 会让 mock 工厂重新执行，闭包对象仍是同一个。
 */
const mkdirProbe = vi.hoisted(() => ({
  impl: null as null | ((path: string) => Promise<void>),
  calls: [] as Array<{ path: string; options: unknown }>,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const realMkdir = actual.mkdir as unknown as (
    path: string,
    options?: unknown
  ) => Promise<void>;
  return {
    ...actual,
    mkdir: async (path: string, options?: unknown) => {
      mkdirProbe.calls.push({ path: String(path), options });
      if (mkdirProbe.impl) return mkdirProbe.impl(String(path));
      return realMkdir(String(path), options);
    },
  };
});

/** node:os.homedir 探针：LOG_DIR 留空时默认目录取自 homedir()，让它抛错即可模拟「日志路径算不出来」。 */
const osProbe = vi.hoisted(() => ({ homedirThrows: false }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => {
      if (osProbe.homedirThrows) throw new Error("homedir unavailable");
      return actual.homedir();
    },
  };
});

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "flow-log-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mkdirProbe.impl = null;
  mkdirProbe.calls.length = 0;
  osProbe.homedirThrows = false;
});

/** 捕获 stderr（顺带静音）：日志行与停用提示都走 stderr。 */
function captureStderr() {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    output: () => chunks.join(""),
    disabledNotices: () =>
      chunks.filter((c) => c.includes("file logging disabled")).length,
  };
}

function fsError(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`${code}: no such file or directory, mkdir '${path}'`),
    { code }
  );
}

/**
 * 模拟「源目录已被删除的 bind mount」：dead 本身 mkdir → EEXIST（目录在），
 * 其下 mkdir → ENOENT（建不出来）。与线上容器内 `mkdir` 的表现一致。
 */
function deadDirImpl(dead: string) {
  return async (path: string): Promise<void> => {
    if (path === dead) throw fsError("EEXIST", path);
    if (path.startsWith(dead + sep)) throw fsError("ENOENT", path);
  };
}

async function freshLogger() {
  vi.resetModules();
  return import("../src/runtime/logger.js");
}

describe("文件日志：LOG_DIR 不可用时不阻塞 agent", () => {
  it("LOG_DIR 正常：启动期行先落 PID 文件，setLogSession 后并入会话文件且顺序不变", async () => {
    const logDir = freshDir();
    vi.stubEnv("LOG_DIR", logDir);
    vi.stubEnv("LOG_LEVEL", "info");
    captureStderr();
    const mod = await freshLogger();
    const {
      logger,
      setLogAgent,
      setLogSession,
      getSessionLogPath,
      flushFileLogging,
      getFileLoggingStatus,
    } = mod;

    expect(getFileLoggingStatus()).toEqual({ state: "unprepared", dir: logDir });

    logger.info("startup line 1");
    logger.info("startup line 2");
    // 路径同步登记，不依赖任何启动初始化（与旧行为一致）
    expect(getSessionLogPath("sess-a")).toBeUndefined();
    setLogAgent("agent-a");
    setLogSession("sess-a");
    expect(getSessionLogPath("sess-a")).toContain(`agent-a-sess-a-`);
    logger.info("session line 1");

    await flushFileLogging();
    expect(getFileLoggingStatus()).toEqual({ state: "enabled", dir: logDir });

    // 一次会话一份日志：PID 文件已并入会话文件
    expect(readdirSync(logDir)).toEqual([basename(getSessionLogPath("sess-a")!)]);
    const lines = readFileSync(getSessionLogPath("sess-a")!, "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("startup line 1");
    expect(lines[1]).toContain("startup line 2");
    expect(lines[2]).toContain("log session agent-a:sess-a");
    expect(lines[3]).toContain("session line 1");
  });

  it("上级目录失效：不递归、mkdir 调用有界，初始化结果为已停用，stderr 只报一次", async () => {
    const root = freshDir();
    const dead = join(root, "dead");
    const logDir = join(dead, "sess-1", "logs");
    vi.stubEnv("LOG_DIR", logDir);
    vi.stubEnv("LOG_LEVEL", "info");
    mkdirProbe.impl = deadDirImpl(dead);
    const stderr = captureStderr();
    const mod = await freshLogger();
    const {
      logger,
      setLogSession,
      getSessionLogPath,
      flushFileLogging,
      getFileLoggingStatus,
    } = mod;

    const started = Date.now();
    logger.info("first line"); // 触发准备：逐级非递归 mkdir → 立即失败
    expect(stderr.output()).toContain("first line"); // stderr 同步输出，不受影响
    await flushFileLogging();
    expect(Date.now() - started).toBeLessThan(2_000);

    expect(getFileLoggingStatus()).toMatchObject({ state: "disabled", dir: logDir });
    expect(getFileLoggingStatus().reason).toContain("ENOENT");
    // 每一级最多两次：logs → sess-1 → dead(EEXIST) → 重试 sess-1(ENOENT) 即止，不再往上走
    expect(mkdirProbe.calls.map((c) => c.path)).toEqual([
      logDir,
      join(dead, "sess-1"),
      dead,
      join(dead, "sess-1"),
    ]);
    for (const call of mkdirProbe.calls) {
      expect((call.options as { recursive?: boolean } | undefined)?.recursive).not.toBe(true);
    }
    expect(stderr.disabledNotices()).toBe(1);
    expect(stderr.output()).toContain(`LOG_DIR "${logDir}" is unusable`);

    // 停用后：不再重试、不再报错，会话日志不再登记，日志继续走 stderr
    logger.info("second line");
    logger.error("third line");
    setLogSession("sess-later");
    expect(getSessionLogPath("sess-later")).toBeUndefined();
    await flushFileLogging();
    expect(mkdirProbe.calls).toHaveLength(4);
    expect(stderr.disabledNotices()).toBe(1);
    expect(stderr.output()).toContain("third line");
  });

  it("文件系统卡住：不阻塞事件循环，LOG_IO_TIMEOUT_MS 超时后停用且只报一次", async () => {
    vi.stubEnv("LOG_DIR", join(freshDir(), "logs"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_IO_TIMEOUT_MS", "50");
    mkdirProbe.impl = () => new Promise<void>(() => {}); // 永不返回
    const stderr = captureStderr();
    const mod = await freshLogger();
    const { logger, flushFileLogging, getFileLoggingStatus } = mod;

    logger.info("while stuck");
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 10);
    const started = Date.now();
    await flushFileLogging();
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(timerFired).toBe(true); // mkdir 挂起期间主线程照常调度
    expect(getFileLoggingStatus()).toMatchObject({ state: "disabled" });
    expect(getFileLoggingStatus().reason).toContain("timed out after 50ms");
    expect(stderr.disabledNotices()).toBe(1);
  });

  it("文件日志停用后 ACP 仍能应答 initialize", async () => {
    const dead = join(freshDir(), "dead");
    vi.stubEnv("LOG_DIR", join(dead, "logs"));
    vi.stubEnv("LOG_LEVEL", "info");
    mkdirProbe.impl = deadDirImpl(dead);
    captureStderr();

    const loggerMod = await freshLogger();
    // 先 resetModules 再取，保证 ACP 这侧和上面拿到的是同一个 logger 实例
    const { DeepAgentsServer } = await import("../src/libs/deepagents-acp/server.js");
    const { createFlowHooks } = await import("../src/surfaces/acp/server.js");

    loggerMod.logger.info("boot");
    await loggerMod.flushFileLogging();
    expect(loggerMod.getFileLoggingStatus().state).toBe("disabled");

    const server = new DeepAgentsServer({
      agents: { name: "test-flow", description: "test agent", tools: [] },
      serverName: "test-flow",
      hooks: createFlowHooks({
        appConfig: { agent: { name: "test-flow", version: "0.0.0" } } as never,
      }),
    });
    const response = await (
      server as unknown as {
        handleInitialize(params: Record<string, unknown>): Promise<{
          protocolVersion: number;
          agentInfo: { name: string };
        }>;
      }
    ).handleInitialize({
      clientInfo: { name: "test-client", version: "0.0.0" },
      protocolVersion: 1,
    });
    expect(response.protocolVersion).toBe(1);
    expect(response.agentInfo.name).toBe("test-flow");
  });

  it("运行中写入失败（目录被删）：只报一次并停用，不重建目录", async () => {
    const logDir = freshDir();
    vi.stubEnv("LOG_DIR", logDir);
    vi.stubEnv("LOG_LEVEL", "info");
    const stderr = captureStderr();
    const mod = await freshLogger();
    const { logger, flushFileLogging, getFileLoggingStatus } = mod;

    logger.info("before delete");
    await flushFileLogging();
    expect(getFileLoggingStatus().state).toBe("enabled");

    rmSync(logDir, { recursive: true, force: true });
    logger.info("after delete 1");
    logger.info("after delete 2");
    logger.info("after delete 3");
    await flushFileLogging();

    expect(getFileLoggingStatus()).toMatchObject({ state: "disabled" });
    expect(getFileLoggingStatus().reason).toContain("ENOENT");
    expect(stderr.disabledNotices()).toBe(1);
    expect(existsSync(logDir)).toBe(false); // 停用后不再发文件 I/O（不重建目录）
    expect(mkdirProbe.calls).toHaveLength(1); // 只在准备时建过一次目录
  });

  it("日志路径算不出来（极端环境）：日志调用与 setLogSession 都不抛错，文件日志停用", async () => {
    vi.stubEnv("LOG_DIR", ""); // 走默认目录 → homedir()
    vi.stubEnv("LOG_LEVEL", "info");
    osProbe.homedirThrows = true;
    const stderr = captureStderr();
    const mod = await freshLogger();
    const {
      logger,
      setLogSession,
      getSessionLogPath,
      flushFileLogging,
      getFileLoggingStatus,
    } = mod;

    // setLogSession 在 session/new 路径上被直接调用，抛错会让会话建立失败
    expect(() => logger.info("still fine")).not.toThrow();
    expect(() => setLogSession("sess-x")).not.toThrow();
    expect(getSessionLogPath("sess-x")).toBeUndefined();
    await flushFileLogging();

    expect(getFileLoggingStatus()).toMatchObject({ state: "disabled" });
    expect(getFileLoggingStatus().reason).toContain("homedir unavailable");
    expect(stderr.disabledNotices()).toBe(1);
    expect(stderr.output()).toContain("still fine");
  });

  it("同一拍内「打完日志立刻退出」：未提交的行由 exit 兜底同步补写", async () => {
    const logDir = freshDir();
    vi.stubEnv("LOG_DIR", logDir);
    vi.stubEnv("LOG_LEVEL", "info");
    captureStderr();
    const mod = await freshLogger();

    mod.logger.info("line already flushed");
    await mod.flushFileLogging(); // 文件日志就绪
    const [file] = readdirSync(logDir);
    const logFile = join(logDir, file!);

    mod.logger.info("last line before exit"); // 入队但尚未提交给线程池（setImmediate 未跑）
    expect(readFileSync(logFile, "utf-8")).not.toContain("last line before exit");

    // 每个用例一个 logger 实例、各注册一个 exit 监听器；取最后注册的，即本用例的实例
    const exitFlush = process
      .listeners("exit")
      .filter((fn) => fn.name === "flushPendingSync")
      .at(-1);
    expect(exitFlush).toBeTypeOf("function");
    exitFlush!(); // 模拟 process.exit 触发的 exit 钩子
    expect(readFileSync(logFile, "utf-8")).toContain("last line before exit");

    // 甩掉本用例遗留的排队项，避免 afterAll 清理临时目录后还有写入
    await mod.flushFileLogging();
    // 兜底写过的行不会再被队列重复写
    expect(
      readFileSync(logFile, "utf-8").match(/last line before exit/g)
    ).toHaveLength(1);
  });
});
