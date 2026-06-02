/**
 * Structured Logger
 *
 * Provides consistent, structured logging for the agent runtime.
 * Supports log levels, context fields, and JSON output mode.
 */

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

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      process.stderr.write(`${this.formatMessage("debug", message, context)}\n`);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      process.stderr.write(`${this.formatMessage("info", message, context)}\n`);
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      process.stderr.write(`${this.formatMessage("warn", message, context)}\n`);
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      process.stderr.write(`${this.formatMessage("error", message, context)}\n`);
    }
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
