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

日志目录优先级：--dir > LOG_DIR env > <cwd>/.logs > <项目根>/.logs(自 cwd 向上找) >
                <项目根>/.logs(自脚本目录向上找) > ~/.flowagents/logs
（开发场景 runtime 日志常落在项目根 .logs/，脚本却可能从子目录调起 → 需向上找项目根。）
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
# 模型/凭证问题：只匹配**明确的失败短语**，不匹配 apiKey/api_key 这类字段名裸出现——
# 否则会把 `[info] ... OPENAI_API_KEY=072d…` 之类正常启动日志误判为问题（历史坑）。
# 真实凭证/模型失败都带明确措辞（Invalid API Key / 401 / Missing credentials 等）。
MODEL_RE = re.compile(
    r"Invalid model|Invalid API Key|Incorrect API key|"
    r"401 Unauthorized|403 Forbidden|Missing credentials|"
    r"authentication failed|invalid[ _-]?token|"
    r"api[ _-]?key (?:is )?(?:invalid|missing|required|not set)",
    re.IGNORECASE,
)
# 性能：runtime 装配阶段计时（perf-trace 输出 `perf ... phase=<name> ms=<n>`）。
PERF_PHASE_RE = re.compile(r"\bperf\b.*?\bphase=(\S+)\s+ms=(\d+)", re.IGNORECASE)
# 汇总行：`perf-summary ... totalMs=<n>`（可选，单阶段行已足够聚合）。
PERF_SUMMARY_RE = re.compile(r"\bperf-summary\b.*?\btotalMs=(\d+)", re.IGNORECASE)
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


# 项目根标记：命中任一即认为该目录是项目根（用于向上定位 <项目根>/.logs）。
_PROJECT_ROOT_MARKERS = ("package.json", ".git", "config")


def _project_root_logs(start: str) -> str | None:
    """从 start 逐级向上，返回首个「含项目根标记且存在 .logs/」目录的 .logs/ 绝对路径。

    开发场景 runtime 把日志写在 <项目根>/.logs，而 analyze-logs 可能从子目录（子包 /
    skill scripts 目录）被调起，`os.getcwd()` ≠ 项目根 → <cwd>/.logs 落空。此处向上兜底。
    找到项目根标记但该层无 .logs/ 时继续向上（兼容嵌套子包），直到文件系统根。
    """
    cur = os.path.abspath(start)
    while True:
        has_marker = any(
            os.path.exists(os.path.join(cur, m)) for m in _PROJECT_ROOT_MARKERS
        )
        if has_marker:
            candidate = os.path.join(cur, ".logs")
            if os.path.isdir(candidate):
                return os.path.abspath(candidate)
        parent = os.path.dirname(cur)
        if parent == cur:  # 到达文件系统根，停止
            return None
        cur = parent


def find_log_dir(explicit: str | None = None) -> str | None:
    """按优先级找日志目录。

    优先级：--dir > LOG_DIR env > <cwd>/.logs > <项目根>/.logs(自 cwd 向上) >
            <项目根>/.logs(自脚本目录向上) > ~/.flowagents/logs。
    """
    candidates = []
    if explicit:
        candidates.append(explicit)
    env_dir = os.environ.get("LOG_DIR", "")
    if env_dir:
        candidates.append(env_dir)
    candidates.append(os.path.join(os.getcwd(), ".logs"))
    # cwd 不是项目根时（子包 / skill scripts 目录调起）向上找 <项目根>/.logs。
    candidates.append(_project_root_logs(os.getcwd()))
    # cwd 与项目完全无关时，再从脚本自身目录向上兜底。
    candidates.append(_project_root_logs(os.path.dirname(os.path.abspath(__file__))))
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
    perf_phases: dict[str, int] = {}
    perf_total: int | None = None

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
        elif (pm := PERF_PHASE_RE.search(line)):
            # 性能阶段行：同名取最大耗时（同一阶段多次装配时取最慢一次，偏保守）。
            phase, ms = pm.group(1), int(pm.group(2))
            perf_phases[phase] = max(perf_phases.get(phase, 0), ms)
        else:
            sm = PERF_SUMMARY_RE.search(line)
            if sm:
                perf_total = int(sm.group(1))
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
        "perf_phases": perf_phases,
        "perf_total": perf_total,
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


def _maybe_print_auth_false_positive_hint(tool_calls: dict, model_issues: list) -> None:
    """工具最终有产出（done>0）时，提示勿把瞬态 auth 波动 / 断言失败误判为鉴权故障。

    背景：ReAct 回路会重试并消化个别请求的瞬态 auth 报错，最终仍拿到数据（done>0，即使过程中有
    个别 failed）。debug.sh 可能因 --expect-tool 用了中文登记名（如「联网搜索_1」）而 exit 4，或
    因权限审批 / ask-question 而 exit 5(HITL)——这些都不是平台鉴权故障。仅当日志出现 401/凭证类
    硬错误（进入 model_issues）且工具始终无产出时，才算真正的鉴权问题。
    """
    if model_issues:
        # 有 401/凭证硬错误时不提示，避免在真鉴权场景误导
        return
    produced = [
        (name, cnt) for name, cnt in tool_calls.items() if cnt.get("done", 0) > 0
    ]
    if not produced:
        return
    # 取 done 次数最多的工具作示例，便于开发 Agent 对照
    name, cnt = max(produced, key=lambda x: x[1]["done"])
    detail = f"{name} done={cnt['done']}"
    if cnt.get("failed", 0) > 0:
        # 个别 failed 但 done>0：ReAct 已重试消化，仍属成功产出
        detail += f", failed={cnt['failed']}（已被 ReAct 重试消化）"
    print(
        f"[提示] 平台工具最终有产出（例: {detail}）。"
        "过程中的个别 auth 波动会被 ReAct 回路重试消化；"
        "debug.sh 因 --expect-tool 未命中（常见中文登记名）或 HITL(exit 5) 失败属断言 / 续接问题，"
        "无 401/凭证硬错误时禁止在收工报告写 Authorization 待办。",
        file=sys.stderr,
    )


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
                    "[ERROR] 找不到日志目录（按优先级查找：LOG_DIR env > <cwd>/.logs > "
                    "<项目根>/.logs(自 cwd/脚本目录向上找) > ~/.flowagents/logs）。",
                    file=sys.stderr,
                )
                print(
                    "[提示] 开发场景 runtime 日志常落在 <项目根>/.logs；确认该目录有产出，"
                    "或设置 LOG_DIR / 用 --dir 显式指定。",
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
    merged_perf: dict[str, int] = {}
    perf_total: int | None = None
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
        for phase, ms in s.get("perf_phases", {}).items():
            merged_perf[phase] = max(merged_perf.get(phase, 0), ms)
        if s.get("perf_total") is not None:
            perf_total = s["perf_total"]
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

    if merged_perf:
        # 按耗时降序，一眼定位启动瓶颈；总耗时优先用 perf-summary，缺失则回退各阶段之和。
        ordered = sorted(merged_perf.items(), key=lambda kv: kv[1], reverse=True)
        total = perf_total if perf_total is not None else sum(merged_perf.values())
        breakdown = " | ".join(f"{name}={ms}ms" for name, ms in ordered)
        print(f"[性能] 加载总耗时≈{total}ms | {breakdown}", file=sys.stderr)

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

    # 工具已成功且无凭证问题时，提示勿误报鉴权（不影响 exit code）
    _maybe_print_auth_false_positive_hint(merged_tools, merged_model)

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
