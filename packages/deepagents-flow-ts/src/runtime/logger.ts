/**
 * Structured Logger
 *
 * Provides consistent, structured logging for the agent runtime.
 * Supports log levels, context fields, JSON output mode, and file logging.
 *
 * Environment variables:
 *   LOG_LEVEL — debug | info | warn | error (default: info)
 *   LOG_DIR   — directory for log files. Defaults to ~/.flowagents/logs.
 *               All log output is tee'd to a timestamped .jsonl file in that directory.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
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

type LogWriter = { path: string; write: (line: string) => void };

/** 全局 agent 名（setLogAgent 设；文件名前缀，默认 FLOWAGENTS_NAME）。 */
let logAgentName = FLOWAGENTS_NAME;
/** per-session writer 缓存（sessionId → writer）：同 session 复用同一文件。 */
const logWriters = new Map<string, LogWriter>();
/** 当前活跃 session 的 writer（setLogSession 设；runtime 各处 emit 写它）。 */
let currentWriter: LogWriter | null = null;
/** 无 session 时的 fallback writer（进程级，懒建），保证启动期日志不丢。 */
let bootstrapWriter: LogWriter | null = null;

/** 文件名安全化：非 [a-zA-Z0-9_\-.] 替成 _（防 agentName/sessionId 含路径字符）。 */
function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-.]/g, "_");
}

/** 今日日期 YYYY.MM.DD（首次写时定文件名日期段）。 */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, ".");
}

/** 敏感字段名（凭证 / 端点 / 模型名）；非 debug 级脱敏其值。 */
const SENSITIVE_KEY = /(?:api[_-]?key|secret|token|auth[_-]?token|password|baseUrl|base[_-]?url|endpoint|url|model(?:Name|name)?)/i;

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

/** 建 per-session writer：<logDir>/<agentName>-<sessionId>-<YYYY.MM.DD>.log（调用方先 mkdir）。 */
function buildWriter(sessionId: string): LogWriter {
  const fname = `${safeFilename(logAgentName)}-${safeFilename(sessionId)}-${todayDate()}.log`;
  const filePath = join(logDir(), fname);
  return {
    path: filePath,
    write: (line: string) => {
      try {
        appendFileSync(filePath, line + "\n");
      } catch {
        /* Swallow write errors — don't crash the agent over logging */
      }
    },
  };
}

/** surfaces 启动时调一次：设全局 agent 名（log 文件名前缀）。 */
export function setLogAgent(name: string): void {
  logAgentName = name || FLOWAGENTS_NAME;
}

/**
 * surfaces 在 session 开始时调：建/取 per-session writer 并设为当前。幂等（同 sessionId 复用）。
 * 文件：~/.flowagents/logs/<agentName>-<sessionId>-<YYYY.MM.DD>.log。
 *
 * 并发：全局 currentWriter 适合 ACP「一个 connection 串行 prompt」。真并发多 session 时
 * 换 AsyncLocalStorage 按 ctx 路由（本实现未做）。
 */
export function setLogSession(sessionId: string): void {
  let w = logWriters.get(sessionId);
  if (!w) {
    try {
      const dir = logDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      w = buildWriter(sessionId);
      logWriters.set(sessionId, w);
      w.write(`${localTimestamp()} [info] [logger] log session ${logAgentName}:${sessionId}  path=${w.path}`);
    } catch (err) {
      process.stderr.write(
        `[logger] Failed to init session log "${sessionId}": ${err instanceof Error ? err.message : String(err)}\n`
      );
      return;
    }
  }
  currentWriter = w;
}

function getLogFile(): LogWriter | null {
  if (currentWriter) return currentWriter;
  // 无 session（server 启动期 / configureSession 前）：fallback 进程级文件，不丢日志。
  if (!bootstrapWriter) {
    try {
      const dir = logDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      bootstrapWriter = buildWriter(`process-${process.pid}`);
    } catch (err) {
      process.stderr.write(
        `[logger] Failed to init bootstrap log: ${err instanceof Error ? err.message : String(err)}\n`
      );
      return null;
    }
  }
  return bootstrapWriter;
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
      const envLevel = process.env.LOG_LEVEL as LogLevel;
      return envLevel && envLevel in LOG_LEVELS ? envLevel : "info";
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

    // Tee to file if LOG_DIR is configured
    const logFile = getLogFile();
    if (logFile) {
      logFile.write(formatted);
    }
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

/** Default logger instance */
export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel) || "info",
  structured: true,
  prefix: "runtime",
});
