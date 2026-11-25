/**
 * Structured Logger
 *
 * Provides consistent, structured logging for the agent runtime.
 * Supports log levels, context fields, JSON output mode, and file logging.
 *
 * Environment variables:
 *   LOG_LEVEL — debug | info | warn | error (default: info)
 *   LOG_DIR   — directory for log files. Defaults to ~/.flowagents/logs.
 *               Log output is tee'd to <agentName>-<sessionId>-<YYYY_MM_DD>.log in that directory.
 *               目录不可用（建不出来 / 只读 / 磁盘满 / 文件系统卡住 / 运行中被删）时自动停用
 *               文件日志：只在 stderr 报一次错，不影响 agent 启动与对话。
 *   LOG_IO_TIMEOUT_MS — 单步日志文件 I/O 的超时（毫秒，默认 2000）；超时即停用文件日志。
 *   LOG_TRACE_FULL — 1/true 时 trace 内容不截断（默认 debug 截 8000 字符、info 截 500）
 *
 * 文件写路径的并发模型（日志 I/O 永不阻塞主线程）：
 *   - emit / writeRawLine / setLogSession 只同步写 stderr 和操作内存；文件 I/O 一律走
 *     fs/promises（libuv 线程池），由一条串行队列按入队顺序执行（同文件连续行合并成一次 append）。
 *   - 绝不使用递归 mkdir（任何形式）：Node 的递归 mkdir 在上级目录失效时会无界重试
 *     （nodejs/node#66268）——同步形式占满一个核并卡死主线程，异步形式占死一个线程池线程。
 *     这里按路径分量逐级调用非递归 mkdir，每一级最多试两次。
 *   - 每一步文件 I/O 都带超时；超时或出错即进入 disabled，之后不再发任何文件 I/O。
 *   - 唯一的同步文件写是进程退出兜底（flushPendingSync），见其注释。
 */

import { appendFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { FLOWAGENTS_NAME, FLOWAGENTS_DIRNAME, LOGS_SUBDIR } from "./paths.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerOptions {
  level?: LogLevel;
  structured?: boolean;
  prefix?: string;
}

type LogWriter = { path: string };

/** 文件队列项：写一行（已含换行），或把启动期 PID 日志文件并入会话日志文件。按入队顺序串行执行。 */
type FileOp =
  | { kind: "line"; path: string; text: string }
  | { kind: "fold"; from: string; to: string };

/** 文件日志状态：unprepared 尚未触发 → pending 准备中 → enabled / disabled（终态，进程内不再恢复）。 */
export type FileLoggingState = "unprepared" | "pending" | "enabled" | "disabled";

export interface FileLoggingStatus {
  state: FileLoggingState;
  /** LOG_DIR 解析后的目录。 */
  dir: string;
  /** state === "disabled" 时：停用原因。 */
  reason?: string;
}

/** 单步日志文件 I/O 的超时（毫秒）；LOG_IO_TIMEOUT_MS 可覆盖。 */
export const LOG_IO_TIMEOUT_DEFAULT_MS = 2_000;

/** 待写队列上限（项）。超出后丢弃文件副本（stderr 不受影响），防止文件系统卡住时内存无限增长。 */
const MAX_PENDING_OPS = 10_000;

/** 单步文件 I/O 超时。与普通 I/O 错误区分开：fold 的普通错误可以吞掉，超时必须停用。 */
class LogIoTimeoutError extends Error {}

/** 全局 agent 名（setLogAgent 设；文件名前缀，默认 FLOWAGENTS_NAME）。 */
let logAgentName = FLOWAGENTS_NAME;
/** per-session writer 缓存（sessionId → writer）：同 session 复用同一文件。 */
const logWriters = new Map<string, LogWriter>();
/** 当前活跃 session 的 writer（setLogSession 设；runtime 各处 emit 写它）。 */
let currentWriter: LogWriter | null = null;
/** 无 session 时的 fallback writer（进程级，懒建），保证启动期日志不丢。 */
let bootstrapWriter: LogWriter | null = null;

let fileState: FileLoggingState = "unprepared";
let disabledReason: string | undefined;
/** 准备阶段确定的日志目录；之后的 writer 都落在它下面。 */
let logRoot: string | null = null;
/** 首次准备时尝试的目录（状态查询与停用提示用）。 */
let attemptedDir: string | null = null;
let preparePromise: Promise<boolean> | null = null;
let ioTimeoutMs = LOG_IO_TIMEOUT_DEFAULT_MS;

/** 串行文件队列。同一时刻最多只有一个 batch 在途（inFlight），保证落盘顺序 = 入队顺序。 */
const pending: FileOp[] = [];
let flushScheduled = false;
let inFlight = false;
let exitFlushRegistered = false;
let drainWaiters: Array<() => void> = [];

/** 文件名安全化：非 [a-zA-Z0-9_\-.] 替成 _（防 agentName/sessionId 含路径字符）。 */
function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-.]/g, "_");
}

/** 今日日期 YYYY_MM_DD（首次写时定文件名日期段）。 */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "_");
}

/** 敏感字段名（凭证 / 端点 / 模型名）；非 debug 级脱敏其值。token 仅匹配带前缀（auth/access/refresh/id）或 jwt，避免误伤 tokenChunks/inputTokens 等计数字段。 */
const SENSITIVE_KEY = /(?:api[_-]?key|secret|(?:auth|access|refresh|id)[_-]?token|jwt|password|baseUrl|base[_-]?url|endpoint|url|model(?:Name|name)?)/i;

/** 本地时间戳 YYYY-MM-DD HH:MM:SS.mmm（参照 nuwaclaw perf.log 行首格式）。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number, l = 2): string => String(n).padStart(l, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 值脱敏：保留前4后2（够辨识、不可还原）；短值直接 ***。 */
function maskValue(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return !s || s.length <= 8 ? "***" : `${s.slice(0, 4)}…${s.slice(-2)}`;
}

/** context → "k=v k=v"，敏感字段在 mask=true 时脱敏。 */
function formatKv(context: Record<string, unknown>, mask: boolean): string {
  return Object.entries(context)
    .map(([k, v]) => {
      const vs = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${mask && SENSITIVE_KEY.test(k) ? maskValue(v) : vs}`;
    })
    .join(" ");
}

/** log 目录：LOG_DIR 覆盖，默认 ~/.flowagents/logs（FLOWAGENTS_DIRNAME/LOGS_SUBDIR 统一自 paths.ts）。 */
function logDir(): string {
  return resolve(process.env.LOG_DIR || join(homedir(), FLOWAGENTS_DIRNAME, LOGS_SUBDIR));
}

/** writer 应落盘的目录：准备阶段确定的目录优先（LOG_DIR 中途变化不会写到未经准备的目录）。 */
function writerRoot(): string {
  return logRoot ?? logDir();
}

/** 状态查询 / 停用提示用的目录名：解析失败时退回原始值，保证这里不抛错。 */
function displayDir(): string {
  if (attemptedDir !== null) return attemptedDir;
  try {
    return logDir();
  } catch {
    return process.env.LOG_DIR || `~/${FLOWAGENTS_DIRNAME}/${LOGS_SUBDIR}`;
  }
}

/** 建 per-session writer：<logDir>/<agentName>-<sessionId>-<YYYY_MM_DD>.log（只算路径，不碰文件系统）。 */
function buildWriter(sessionId: string): LogWriter {
  const fname = `${safeFilename(logAgentName)}-${safeFilename(sessionId)}-${todayDate()}.log`;
  return { path: join(writerRoot(), fname) };
}

/** surfaces 启动时调一次：设全局 agent 名（log 文件名前缀）。 */
export function setLogAgent(name: string): void {
  logAgentName = name || FLOWAGENTS_NAME;
}

// ── 文件写路径：状态机 + 串行异步队列 ─────────────────────────────────────

function errnoCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** 单步文件 I/O 超时护栏：文件系统卡住时底层调用不会返回（线程池线程被占住），但主线程按时拿到超时结果。 */
async function ioWithTimeout<T>(op: Promise<T>, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new LogIoTimeoutError(`${step} timed out after ${ioTimeoutMs}ms`)),
          ioTimeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 逐级、非递归建目录（不传 recursive，见文件头注释）。
 * EEXIST 视为成功；ENOENT 先补父目录再重试一次——每一级最多两次，调用次数随路径深度有界。
 * 上级目录已失效（如源目录被删的 bind mount）时，补父目录得到 EEXIST/ENOENT，重试仍是 ENOENT → 立即失败。
 */
async function mkdirLevels(dir: string): Promise<void> {
  try {
    await ioWithTimeout(mkdir(dir), "mkdir");
  } catch (err) {
    const code = errnoCode(err);
    if (code === "EEXIST") return;
    if (code !== "ENOENT") throw err;
    const parent = dirname(dir);
    if (parent === dir) throw err;
    await mkdirLevels(parent);
    try {
      await ioWithTimeout(mkdir(dir), "mkdir");
    } catch (retryErr) {
      if (errnoCode(retryErr) !== "EEXIST") throw retryErr;
    }
  }
}

/**
 * 停用文件日志（幂等）：进程内一次性，之后不再发任何文件 I/O；只在 stderr 报一次原因。
 * 可在任意调用点触发：队列里尚未执行的项随之丢弃，在途 batch 由 runBatch 自行中止。
 */
function disable(step: string, err: unknown): void {
  if (fileState === "disabled") return;
  fileState = "disabled";
  disabledReason = `${step}: ${describeError(err)}`;
  pending.length = 0;
  logWriters.clear();
  currentWriter = null;
  bootstrapWriter = null;
  process.stderr.write(
    `[logger] file logging disabled — LOG_DIR "${displayDir()}" is unusable (${disabledReason}). Logs continue on stderr only.\n`
  );
}

/** 确保日志目录已准备（惰性、进程内一次）。返回文件日志是否可用。 */
async function ensurePrepared(): Promise<boolean> {
  if (fileState === "enabled") return true;
  if (fileState === "disabled") return false;
  if (!preparePromise) {
    fileState = "pending";
    preparePromise = prepare();
  }
  return preparePromise;
}

async function prepare(): Promise<boolean> {
  // 整体兜住：任何一步出错都只是停用文件日志，绝不向外抛。
  try {
    ioTimeoutMs = parsePositiveInt(process.env.LOG_IO_TIMEOUT_MS) ?? LOG_IO_TIMEOUT_DEFAULT_MS;
    const dir = logDir();
    attemptedDir = dir;
    await mkdirLevels(dir);
    logRoot = dir;
    fileState = "enabled";
    return true;
  } catch (err) {
    disable("create LOG_DIR", err);
    return false;
  }
}

function enqueue(op: FileOp): void {
  if (fileState === "disabled") return;
  if (pending.length >= MAX_PENDING_OPS) return;
  // 入队即注册退出兜底：「同一拍内打完日志就 process.exit」时队列还没开始跑，但行已经需要有人补写。
  registerExitFlush();
  pending.push(op);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled || inFlight) return;
  flushScheduled = true;
  // 推迟一拍再提交给线程池：同一拍内「打完日志立刻 process.exit」时这些行还没在途，
  // 可由 flushPendingSync 同步补写。
  setImmediate(runFlush);
}

function settleDrain(): void {
  if (inFlight || flushScheduled || pending.length > 0) return;
  const waiters = drainWaiters;
  drainWaiters = [];
  for (const resolveWaiter of waiters) resolveWaiter();
}

async function runFlush(): Promise<void> {
  flushScheduled = false;
  if (inFlight || pending.length === 0) {
    settleDrain();
    return;
  }
  inFlight = true;
  const batch = pending.splice(0, pending.length);
  try {
    if (await ensurePrepared()) await runBatch(batch);
  } catch {
    /* runBatch 自行处理 I/O 错误；这里只兜住意外，日志不应拖垮 agent */
  } finally {
    inFlight = false;
    if (fileState !== "disabled" && pending.length > 0) scheduleFlush();
    settleDrain();
  }
}

async function runBatch(batch: FileOp[]): Promise<void> {
  for (let i = 0; i < batch.length; i++) {
    if (fileState === "disabled") return;
    const op = batch[i]!;
    if (op.kind === "fold") {
      try {
        await foldFile(op.from, op.to);
      } catch (err) {
        // 并入失败不应影响会话日志（与原同步实现一致）；只有超时（文件系统卡住）才停用。
        if (!(err instanceof LogIoTimeoutError)) continue;
        disable(`fold startup log into "${op.to}"`, err);
        return;
      }
      continue;
    }
    // 连续同文件的行合并成一次 append（减少 syscall；顺序不变）。
    let text = op.text;
    while (i + 1 < batch.length) {
      const next = batch[i + 1]!;
      if (next.kind !== "line" || next.path !== op.path) break;
      text += next.text;
      i++;
    }
    try {
      await ioWithTimeout(appendFile(op.path, text), "append log file");
    } catch (err) {
      disable(`write "${op.path}"`, err);
      return;
    }
  }
}

/**
 * 把 bootstrap（PID）启动期日志并入刚建立的 session 日志文件，保证「一次会话 = 一份日志」。
 *   - session 文件不存在 → rename（PID 文件直接成为 session 文件的开头）
 *   - session 文件已存在（同日 resume 同 sessionId）→ append PID 内容后删除 PID 文件
 * 非 I/O 超时的失败一律吞掉；超时向上抛出（由 runBatch 停用文件日志）。
 */
async function foldFile(from: string, to: string): Promise<void> {
  let targetExists = false;
  try {
    await ioWithTimeout(stat(to), "stat log file");
    targetExists = true;
  } catch (err) {
    if (err instanceof LogIoTimeoutError) throw err;
  }
  try {
    if (!targetExists) {
      await ioWithTimeout(rename(from, to), "rename log file");
      return;
    }
    const prev = await ioWithTimeout(readFile(from, "utf-8"), "read log file");
    if (prev) await ioWithTimeout(appendFile(to, prev), "append log file");
    await ioWithTimeout(unlink(from), "unlink log file");
  } catch (err) {
    if (err instanceof LogIoTimeoutError) throw err;
    /* 合并失败不阻断 session 日志 */
  }
}

function registerExitFlush(): void {
  if (exitFlushRegistered) return;
  exitFlushRegistered = true;
  process.on("exit", flushPendingSync);
}

/**
 * 进程退出兜底：把尚未提交给线程池的行同步补写（如「打完 error 立刻 process.exit」或未捕获异常），
 * 与原先同步写文件的行为对齐，避免最后一行丢失。
 * 只在文件日志可用且没有在途写入时执行——有在途写入说明文件系统正被访问且尚未确认可用，
 * 此时再同步写可能把退出也卡住。
 */
function flushPendingSync(): void {
  if (fileState !== "enabled" || inFlight || pending.length === 0) return;
  try {
    let path = "";
    let text = "";
    for (const op of pending) {
      if (op.kind !== "line") continue;
      if (op.path !== path) {
        if (text) appendFileSync(path, text);
        path = op.path;
        text = "";
      }
      text += op.text;
    }
    if (text) appendFileSync(path, text);
  } catch {
    /* 退出路径：兜底失败忽略 */
  } finally {
    pending.length = 0;
  }
}

/** 诊断/测试：文件日志状态与目标目录；disabled 时带原因。 */
export function getFileLoggingStatus(): FileLoggingStatus {
  const status: FileLoggingStatus = { state: fileState, dir: displayDir() };
  if (disabledReason !== undefined) status.reason = disabledReason;
  return status;
}

/** 诊断/测试：等已入队的文件日志写完（或文件日志已停用）后返回。 */
export function flushFileLogging(): Promise<void> {
  if (!inFlight && !flushScheduled && pending.length === 0) return Promise.resolve();
  return new Promise<void>((resolveWaiter) => {
    drainWaiters.push(resolveWaiter);
  });
}

/**
 * surfaces 在 session 开始时调：登记/取 per-session writer 并设为当前。幂等（同 sessionId 复用）。
 * 文件：<logDir>/<agentName>-<sessionId>-<YYYY_MM_DD>.log。
 * 只操作内存：建目录与写文件由串行队列异步完成；文件日志已停用时直接跳过。
 *
 * 并发：全局 currentWriter 适合 ACP「一个 connection 串行 prompt」。真并发多 session 时
 * 换 AsyncLocalStorage 按 ctx 路由（本实现未做）。
 */
export function setLogSession(sessionId: string): void {
  if (fileState === "disabled") {
    currentWriter = null;
    return;
  }
  let w = logWriters.get(sessionId);
  if (!w) {
    try {
      w = buildWriter(sessionId);
    } catch (err) {
      // 连日志路径都算不出来（极端环境）：停用文件日志。本函数在 session/new 路径上被直接调用，绝不抛错。
      disable("resolve log file path", err);
      return;
    }
    logWriters.set(sessionId, w);
    // 启动期 PID 日志并入会话文件（一次会话一份），随后写会话标记行。
    // 与之前的启动期日志行进同一条队列，天然保序：先写完 PID 文件，再并入。
    if (bootstrapWriter) {
      enqueue({ kind: "fold", from: bootstrapWriter.path, to: w.path });
      bootstrapWriter = null;
    }
    enqueue({
      kind: "line",
      path: w.path,
      text: `${localTimestamp()} [info] [logger] log session ${logAgentName}:${sessionId}  path=${w.path}\n`,
    });
  }
  currentWriter = w;
}

/** 诊断/测试：返回已绑定的 per-session 日志文件路径（未绑定或文件日志已停用则 undefined）。 */
export function getSessionLogPath(sessionId: string): string | undefined {
  return logWriters.get(sessionId)?.path;
}

/** 当前文件日志目标：会话 writer，否则进程级（PID）writer——只算路径，不碰文件系统。 */
function currentLogFile(): LogWriter {
  if (currentWriter) return currentWriter;
  // 无 session（server 启动期 / configureSession 前）：fallback 进程级文件，不丢日志。
  // sessionId 直接用 pid，避免文件名里出现固定的 "process" 段。
  bootstrapWriter ??= buildWriter(String(process.pid));
  return bootstrapWriter;
}

function teeToLogFile(line: string): void {
  if (fileState === "disabled") return;
  let path: string;
  try {
    path = currentLogFile().path;
  } catch (err) {
    // 连日志路径都算不出来（极端环境）：停用文件日志。日志调用绝不向业务代码抛错。
    disable("resolve log file path", err);
    return;
  }
  enqueue({ kind: "line", path, text: `${line}\n` });
}

/** 读取全局有效日志级别（env 或默认 info）。 */
export function getEffectiveLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel;
  return envLevel && envLevel in LOG_LEVELS ? envLevel : "info";
}

/**
 * trace 内容截断上限。LOG_TRACE_FULL=1 时不截断；
 * debug 默认 8000 字符，info 默认 500（摘要级）。
 */
export function resolveTraceMaxChars(override?: number): number {
  if (
    process.env.LOG_TRACE_FULL === "1" ||
    process.env.LOG_TRACE_FULL?.toLowerCase() === "true"
  ) {
    return Number.POSITIVE_INFINITY;
  }
  if (override != null) return override;
  return getEffectiveLogLevel() === "debug" ? 8000 : 500;
}

/** 截断长文本用于日志行；保留尾部省略提示。 */
export function truncateForLog(text: string, maxChars?: number): string {
  const limit = resolveTraceMaxChars(maxChars);
  if (!Number.isFinite(limit) || text.length <= limit) return text;
  return `${text.slice(0, limit)}…[+${text.length - limit} chars]`;
}

/** 把 LangChain 风格 message（duck-type _getType）格式化为可读多行文本。 */
export function formatMessagesForLog(
  messages: Array<{
    _getType?: () => string;
    content?: unknown;
    tool_calls?: unknown;
  }>,
  opts?: { full?: boolean }
): string {
  const full = opts?.full ?? getEffectiveLogLevel() === "debug";
  return messages
    .map((m, i) => {
      const role = m._getType?.() ?? "unknown";
      const content =
        typeof m.content === "string"
          ? m.content
          : m.content != null
            ? JSON.stringify(m.content, null, 2)
            : "";
      const body = full ? content : truncateForLog(content, 200);
      const tools =
        m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length
          ? `\n  tool_calls: ${JSON.stringify(m.tool_calls, null, 2)}`
          : "";
      return `[${i}] ${role}: ${body}${tools}`;
    })
    .join("\n");
}

/** 把任意 payload 序列化为日志块文本。 */
export function formatPayloadForLog(payload: unknown, full?: boolean): string {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return full || getEffectiveLogLevel() === "debug" ? text : truncateForLog(text);
}

function writeRawLine(line: string): void {
  // stderr 同步写，不受文件日志状态影响；文件副本进串行队列。
  process.stderr.write(`${line}\n`);
  teeToLogFile(line);
}

export class Logger {
  private level: LogLevel | "dynamic";
  private structured: boolean;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "dynamic";
    this.structured = options.structured ?? true;
    this.prefix = options.prefix ?? "";
  }

  private getEffectiveLevel(): LogLevel {
    if (this.level === "dynamic") {
      return getEffectiveLogLevel();
    }
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.getEffectiveLevel()];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): string {
    // nuwaclaw 风格纯文本：[本地时间] [level] [prefix] message  k=v k=v
    // 非 debug 级对敏感字段（凭证/端点/模型名）脱敏；debug 级全量展示便于排查。
    const mask = this.getEffectiveLevel() !== "debug";
    const kv =
      context && Object.keys(context).length ? "  " + formatKv(context, mask) : "";
    return `${localTimestamp()} [${level}] ${this.prefix ? `[${this.prefix}] ` : ""}${message}${kv}`;
  }

  private emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, context);

    // Always write to stderr
    process.stderr.write(`${formatted}\n`);

    // Tee to file（异步队列；LOG_DIR 不可用时只走 stderr）
    teeToLogFile(formatted);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit("error", message, context);
  }

  /**
   * 多行块日志：先打一行标题（含 prefix/level），再打缩进正文。
   * 用于 LLM 消息、工具 args/result 等调试场景的全文 dump。
   */
  block(level: LogLevel, tag: string, body: string): void {
    if (!this.shouldLog(level)) return;
    writeRawLine(this.formatMessage(level, `${tag} ▼`));
    for (const line of body.split("\n")) {
      writeRawLine(`  ${line}`);
    }
    writeRawLine(this.formatMessage(level, `${tag} ▲`));
  }

  /** Create a child logger with additional prefix */
  child(subPrefix: string): Logger {
    const newPrefix = this.prefix ? `${this.prefix}:${subPrefix}` : subPrefix;
    return new Logger({
      level: this.level === "dynamic" ? undefined : this.level,
      structured: this.structured,
      prefix: newPrefix,
    });
  }
}

/** Default logger instance —— dynamic level，跟随运行时 LOG_LEVEL（含 bootstrapFlowAcp --debug）。 */
export const logger = new Logger({
  structured: true,
  prefix: "runtime",
});
