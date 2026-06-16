/**
 * Structured Logger
 *
 * Provides consistent, structured logging for the agent runtime.
 * Supports log levels, context fields, JSON output mode, and file logging.
 *
 * Environment variables:
 *   LOG_LEVEL — debug | info | warn | error (default: info)
 *   LOG_DIR   — directory for log files (e.g., ./logs). When set, all log
 *               output is tee'd to a timestamped .jsonl file in that directory.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

/** Lazy-initialized file writer — created once on first write */
let logFileStream: { path: string; write: (line: string) => void } | null = null;

function getLogFile(): { path: string; write: (line: string) => void } | null {
  if (logFileStream) return logFileStream;

  const logDir = process.env.LOG_DIR;
  if (!logDir) return null;

  try {
    const dir = resolve(logDir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filePath = resolve(dir, `agent-${timestamp}-${process.pid}.jsonl`);

    logFileStream = {
      path: filePath,
      write: (line: string) => {
        try {
          appendFileSync(filePath, line + "\n");
        } catch {
          // Swallow write errors — don't crash the agent over logging
        }
      },
    };

    // Write initial marker
    logFileStream.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Log file initialized",
      logDir: dir,
      pid: process.pid,
    }));

    return logFileStream;
  } catch (err) {
    // Warn on stderr so operator knows file logging failed
    process.stderr.write(
      `[logger] Failed to initialize log file in "${logDir}": ${err instanceof Error ? err.message : String(err)}\n`
    );
    return null;
  }
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
    const timestamp = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}] ` : "";

    if (this.structured) {
      const entry = {
        timestamp,
        level,
        prefix: this.prefix || undefined,
        message,
        ...context,
      };
      return JSON.stringify(entry);
    }

    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    return `${timestamp} [${level.toUpperCase()}] ${prefix}${message}${contextStr}`;
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
