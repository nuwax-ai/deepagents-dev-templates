#!/usr/bin/env python3
"""analyze-logs.py — 分析 .logs/ 运行日志（真实调试的 runtime 视角诊断步骤）。

读取 flow-ts runtime 日志（nuwaclaw 风格纯文本行），提取：
- 错误（ERROR/Exception/Traceback/Failed 等）
- 工具调用统计（tool invoke start/done/failed + toolName）
- flow 状态（flow.run done/prompt_end 的 flowStatus/outputChars/answerChars）
- permission / HITL 事件
- 模型/凭证问题（Invalid model / 401 / apiKey）

与 debug.sh（平台视角 SSE 结果）组成完整调试闭环：debug.sh 看平台返回的结构化结果，
analyze-logs.sh 看 runtime 内部的详细日志，二者结合定位问题。

日志目录优先级：--dir > LOG_DIR env > <cwd>/.logs > ~/.flowagents/logs
退出码：0 正常(未发现问题) | 1 参数错 | 3 找不到日志 | 4 发现问题(错误/模型/失败工具/flowStatus 异常)
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time

from debug_http import configure_stdio_utf8

# === 正则（沿用历史本地 smoke 判定思路 + 平台 devLogParser）==============
ERROR_RE = re.compile(
    r"\[ERROR\]|\[error\]|Exception|Traceback|TypeError|ReferenceError|SyntaxError|"
    r"FATAL|Module not found|Can.t resolve|ELIFECYCLE|PostCSS Error|\bFailed\b|"
    r"Internal server error",
    re.IGNORECASE,
)
TOOL_RE = re.compile(
    r"tool invoke (start|done|failed)\b.*?\btoolName=(\S+)", re.IGNORECASE
)
TRACE_RE = re.compile(r"(?:flow\.run done|prompt_end)\b")
PERM_RE = re.compile(
    r"permission|requestPermission|\binterrupt\b|\bHITL\b", re.IGNORECASE
)
MODEL_RE = re.compile(
    r"Invalid model|Invalid API Key|401 Unauthorized|403 Forbidden|"
    r"\bapiKey\b|api_key|Missing credentials",
    re.IGNORECASE,
)
TRACE_FIELDS = (
    "flowStatus",
    "outputChars",
    "answerChars",
    "questionChars",
    "streamed",
    "streamChars",
    "tokenChunks",
)
# ===========================================================================


def _parse_field(line: str, key: str):
    m = re.search(r"\b" + re.escape(key) + r"=(\S+)", line)
    if not m:
        return None
    raw = m.group(1)
    if raw == "true":
        return True
    if raw == "false":
        return False
    if re.fullmatch(r"\d+", raw):
        return int(raw)
    return raw


def find_log_dir(explicit: str | None = None) -> str | None:
    """按优先级找日志目录：--dir > LOG_DIR env > <cwd>/.logs > ~/.flowagents/logs。"""
    candidates = []
    if explicit:
        candidates.append(explicit)
    env_dir = os.environ.get("LOG_DIR", "")
    if env_dir:
        candidates.append(env_dir)
    candidates.append(os.path.join(os.getcwd(), ".logs"))
    candidates.append(os.path.expanduser("~/.flowagents/logs"))
    for c in candidates:
        if c and os.path.isdir(c):
            return os.path.abspath(c)
    return None


def list_log_files(
    log_dir: str, session: str = "", since_min: float = 0
) -> list[str]:
    """列出日志文件，按 mtime 倒序。session 非空时按文件名包含过滤。"""
    files: list[str] = []
    now = time.time()
    for name in os.listdir(log_dir):
        if not name.endswith(".log"):
            continue
        p = os.path.join(log_dir, name)
        if not os.path.isfile(p):
            continue
        if since_min > 0 and (now - os.path.getmtime(p)) > since_min * 60:
            continue
        if session and session not in name:
            continue
        files.append(p)
    files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return files


def parse_log(path: str) -> dict | None:
    """解析单个日志文件 → 结构化摘要（纯函数，便于自测）。

    返回 {errors, flow_trace, tool_calls, permissions, model_issues,
          first_ts, last_ts, line_count} 或 None（读失败/空）。
    """
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return None
    if not lines:
        return None

    errors: list[str] = []
    tool_calls: dict[str, dict] = {}
    permissions: list[str] = []
    model_issues: list[str] = []
    flow_trace: dict | None = None

    for raw in lines:
        line = raw.rstrip("\n")
        stripped = line.strip()
        m = TOOL_RE.search(line)
        if m:
            # 工具摘要行：只计 tool_calls，不重复进 errors（避免 "tool invoke failed" 误报）
            status, name = m.group(1).lower(), m.group(2)
            d = tool_calls.setdefault(name, {"start": 0, "done": 0, "failed": 0})
            if status in d:
                d[status] += 1
        else:
            if ERROR_RE.search(line):
                errors.append(stripped)
            if PERM_RE.search(line):
                permissions.append(stripped)
            if MODEL_RE.search(line):
                model_issues.append(stripped)
        if TRACE_RE.search(line):
            # 合并 flow.run done / prompt_end 各自的字段（不覆盖）。
            for k in TRACE_FIELDS:
                v = _parse_field(line, k)
                if v is not None:
                    if flow_trace is None:
                        flow_trace = {}
                    flow_trace[k] = v

    def _ts(idx: int) -> str:
        if idx < 0 or idx >= len(lines):
            return ""
        return lines[idx].split(" ")[0].strip()

    return {
        "errors": errors,
        "flow_trace": flow_trace,
        "tool_calls": tool_calls,
        "permissions": permissions,
        "model_issues": model_issues,
        "first_ts": _ts(0),
        "last_ts": _ts(-1),
        "line_count": len(lines),
    }


def _has_problem(summary: dict) -> bool:
    """是否发现需要关注的问题。"""
    if summary["errors"]:
        return True
    if summary["model_issues"]:
        return True
    if any(c["failed"] > 0 for c in summary["tool_calls"].values()):
        return True
    fs = (summary["flow_trace"] or {}).get("flowStatus")
    if fs and fs not in ("done", "interrupted"):
        return True
    return False


def main() -> None:
    configure_stdio_utf8()

    p = argparse.ArgumentParser(description="分析 .logs/ 运行日志（runtime 视角诊断）")
    p.add_argument("--dir", default="", help="日志目录（覆盖 LOG_DIR env / 默认查找）")
    p.add_argument("--session", default="", help="按 sessionId/conversationId 过滤文件名")
    p.add_argument("--since", type=float, default=0, help="仅最近 N 分钟修改的日志")
    p.add_argument("--file", default="", help="直接指定单个日志文件（跳过目录查找）")
    p.add_argument("--max-errors", type=int, default=10, help="最多显示错误行数")
    args = p.parse_args()

    # 定位日志文件
    if args.file:
        if not os.path.isfile(args.file):
            print(f"[ERROR] 日志文件不存在: {args.file}", file=sys.stderr)
            sys.exit(3)
        files = [args.file]
    else:
        if args.dir:
            # 显式 --dir：必须存在，不 fallback（避免误读到全局日志）
            if not os.path.isdir(args.dir):
                print(f"[ERROR] 指定的日志目录不存在: {args.dir}", file=sys.stderr)
                sys.exit(3)
            log_dir = os.path.abspath(args.dir)
        else:
            log_dir = find_log_dir()
            if not log_dir:
                print(
                    "[ERROR] 找不到日志目录（按优先级查找：LOG_DIR env > <cwd>/.logs > ~/.flowagents/logs）。",
                    file=sys.stderr,
                )
                print(
                    "[提示] 若 runtime 未写日志，确认 flow-ts 已设置 LOG_DIR 或默认 ~/.flowagents/logs 有产出；"
                    "或用 --dir 显式指定。",
                    file=sys.stderr,
                )
                sys.exit(3)
        files = list_log_files(log_dir, args.session, args.since)
        if not files:
            print(
                f"[ERROR] {log_dir} 下无匹配日志文件"
                + (f"（session={args.session}）" if args.session else "")
                + (f"（最近 {args.since} 分钟内）" if args.since else ""),
                file=sys.stderr,
            )
            sys.exit(3)
        files = files[:1]  # 默认只分析最新一个

    # 解析（多文件合并）
    merged_errors: list[str] = []
    merged_tools: dict[str, dict] = {}
    merged_perms: list[str] = []
    merged_model: list[str] = []
    flow_trace: dict | None = None
    analyzed = []

    for fp in files:
        s = parse_log(fp)
        if not s:
            continue
        analyzed.append((fp, s))
        merged_errors.extend(s["errors"])
        for name, cnt in s["tool_calls"].items():
            d = merged_tools.setdefault(name, {"start": 0, "done": 0, "failed": 0})
            for k in d:
                d[k] += cnt[k]
        merged_perms.extend(s["permissions"])
        merged_model.extend(s["model_issues"])
        if s["flow_trace"]:
            flow_trace = s["flow_trace"]  # 取最后一个有效 trace

    if not analyzed:
        print("[ERROR] 日志文件为空或无法解析。", file=sys.stderr)
        sys.exit(3)

    fp, s = analyzed[0]
    # === 输出结构化分析（stderr）===
    print(f"[日志] {fp} ({s['line_count']} 行, {s['first_ts']} ~ {s['last_ts']})", file=sys.stderr)

    if flow_trace:
        parts = [f"{k}={v}" for k, v in flow_trace.items()]
        print(f"[flow 状态] {' '.join(parts)}", file=sys.stderr)
    else:
        print("[flow 状态] 未检测到 flow.run done/prompt_end（可能执行未完成或非 flow 调试）", file=sys.stderr)

    if merged_tools:
        tool_summary = " | ".join(
            f"{n}(start={c['start']},done={c['done']},failed={c['failed']})"
            for n, c in merged_tools.items()
        )
        print(f"[工具调用] {tool_summary}", file=sys.stderr)

    if merged_perms:
        print(f"[permission/HITL] {len(merged_perms)} 个事件", file=sys.stderr)

    if merged_model:
        print(f"[模型/凭证问题] {len(merged_model)} 条:", file=sys.stderr)
        for line in merged_model[: args.max_errors]:
            print(f"  > {line}", file=sys.stderr)

    if merged_errors:
        print(f"[错误] {len(merged_errors)} 条（最多显示 {args.max_errors}）:", file=sys.stderr)
        for line in merged_errors[: args.max_errors]:
            print(f"  > {line}", file=sys.stderr)
    else:
        print("[错误] 无", file=sys.stderr)

    summary = {
        "errors": merged_errors,
        "model_issues": merged_model,
        "tool_calls": merged_tools,
        "flow_trace": flow_trace,
    }
    if _has_problem(summary):
        print(
            "[结论] 发现问题（见上方 错误/模型/失败工具/flowStatus）；结合 debug.sh 的平台结果一起定位。",
            file=sys.stderr,
        )
        sys.exit(4)
    print("[结论] 日志正常，未发现错误/模型/失败工具。", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
