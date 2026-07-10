#!/usr/bin/env python3
"""debug.py — 真实调试目标 Agent（平台真实执行 SSE + outcome 判定 + 错误聚合）。

发 prompt 驱动平台真实 agent 执行（POST /conversation/chat，SSE），收事件流，
提取 文本回复 / 工具调用 trace / 错误，判定通过/失败，聚合失败原因。
执行挂在用户 agent-dev 预览会话（CONVERSATION_ID）上，用户可在 nuwax 预览面板看到输出。
严格镜像 nuwax agent-dev 调试会话（事件结构/端点契约见 references/sse-events.md）。

退出码：0 通过 | 1 参数错误 | 2 平台未就绪(env 缺) | 3 HTTP/SSE 失败(含端点未就绪/超时/流中断)
       | 4 调试不通过 | 5 遇 HITL（权限审批/ask-question）待人工响应
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from debug_http import (
    ASK_QUESTION_SUBEVENT_TYPES,
    CHAT_PATH,
    PERMISSION_EVENT_TYPES,
    PERMISSION_RESPONSE_PATH,
    PERMISSION_SUBEVENT_TYPES,
    api_request,
    configure_stdio_utf8,
    conversation_id,
    read_text_option,
    sse_request,
)


# === 纯函数：SSE 事件 → 结构化数据（便于自测，不依赖网络）===================


def extract_text(data) -> str:
    """从 MESSAGE 事件的 data 提取文本片段。

    AgentOutputDto 的 MESSAGE.data 通常是 ChatMessageDto 序列化（含 text 字段），
    也可能是纯字符串。二者都兼容。
    """
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        return data.get("text", "") or ""
    return ""


def _non_empty(v) -> bool:
    if v is None:
        return False
    if isinstance(v, str):
        return len(v.strip()) > 0
    try:
        return len(v) > 0
    except TypeError:
        return True


def parse_tool_calls(final_result) -> list[dict]:
    """从 FINAL_RESULT.data（AgentExecuteResult）提取工具调用 trace。

    每个 ComponentExecuteResult → {name, type, success, error, has_data}。
    """
    if not isinstance(final_result, dict):
        return []
    comps = final_result.get("componentExecuteResults") or []
    calls: list[dict] = []
    for c in comps:
        if not isinstance(c, dict):
            continue
        calls.append(
            {
                "name": c.get("name", "") or "",
                "type": str(c.get("type", "") or ""),
                "success": c.get("success"),
                "error": c.get("error"),
                "has_data": _non_empty(c.get("data")),
            }
        )
    return calls


def judge_outcome(
    final_result, text_chunks: list[str], errors: list[str], expect_tool: str = ""
) -> dict:
    """判定一次调试通过/失败（沿用历史本地 smoke 的 trace 成功判定思路）。

    返回 {failed, reason, text_output, tool_calls, errors}。
    """
    if isinstance(final_result, dict) and final_result.get("outputText"):
        text_output = final_result["outputText"]
    else:
        text_output = "".join(text_chunks)

    tool_calls = parse_tool_calls(final_result)

    # 1. 有任何错误（ERROR 事件 / FINAL_RESULT.error）→ 失败
    if errors:
        return _fail("; ".join(errors), text_output, tool_calls, errors)
    if isinstance(final_result, dict) and final_result.get("error"):
        return _fail(
            f"Agent 执行错误: {final_result['error']}",
            text_output,
            tool_calls,
            errors,
        )

    # 2. 文本输出为空 → 失败（对应 isSmokeFlowSuccess 的文本非空判定）
    if not (text_output and text_output.strip()):
        return _fail(
            "Agent 文本输出为空（outputText 为空且无 MESSAGE 文本）",
            text_output,
            tool_calls,
            errors,
        )

    # 3. 工具调用断言（对应 evaluateExpectedTool）
    if expect_tool:
        want = expect_tool.lower()
        matched = [c for c in tool_calls if want in c["name"].lower()]
        if not matched:
            return _fail(
                f'期望工具 "{expect_tool}" 未被调用（componentExecuteResults 中无名称匹配项）',
                text_output,
                tool_calls,
                errors,
            )
        failed_calls = [c for c in matched if c["success"] is False]
        if failed_calls:
            return _fail(
                f'工具调用失败: {failed_calls[0]["name"]} — {failed_calls[0].get("error", "") or "无错误详情"}',
                text_output,
                tool_calls,
                errors,
            )
        if all(not c["has_data"] for c in matched):
            return _fail(
                f'工具 "{matched[0]["name"]}" 调用成功但返回数据为空',
                text_output,
                tool_calls,
                errors,
            )

    return {
        "failed": False,
        "reason": "",
        "text_output": text_output,
        "tool_calls": tool_calls,
        "errors": errors,
    }


def _fail(reason, text_output, tool_calls, errors) -> dict:
    return {
        "failed": True,
        "reason": reason,
        "text_output": text_output,
        "tool_calls": tool_calls,
        "errors": errors,
    }


def aggregate_error_context(final_result, errors: list[str], tool_calls: list[dict]) -> str:
    """结构化失败原因定位（数据源是 AgentExecuteResult，非纯文本日志）。"""
    sections: list[str] = []
    if isinstance(final_result, dict) and final_result.get("error"):
        sections.append(f"[执行错误] {final_result['error']}")
    for err in errors:
        sections.append(f"[流错误] {err}")
    for c in tool_calls:
        if c.get("success") is False:
            line = f"[工具失败] {c['name']} (type={c['type']})"
            if c.get("error"):
                line += f"\n  错误: {c['error']}"
            sections.append(line)
    for c in tool_calls:
        if c.get("success") is True and not c.get("has_data"):
            sections.append(f"[工具空结果] {c['name']} 调用成功但返回为空")
    total = len(tool_calls)
    failed = sum(1 for c in tool_calls if c.get("success") is False)
    if total > 0:
        sections.append(f"[工具摘要] 共 {total} 次调用, {failed} 次失败")
    return "\n".join(sections) if sections else "未定位到明确错误原因"


def _extract_tool_id(data: dict) -> str:
    """从 ACP_REQUEST_PERMISSION 事件提取 tool_call_id（nuwax 多位置兼容）。"""
    req = data.get("request_permission_request") or data.get("requestPermissionRequest") or {}
    if not isinstance(req, dict):
        req = {}
    tool_call = req.get("toolCall") or req.get("tool_call") or {}
    if not isinstance(tool_call, dict):
        tool_call = {}
    return (
        data.get("tool_call_id")
        or data.get("toolCallId")
        or tool_call.get("toolCallId")
        or tool_call.get("tool_call_id")
        or ""
    )


def _handle_permission(event: dict, args, conv: str) -> None:
    """权限审批（ACP_REQUEST_PERMISSION）。--auto-approve 自动批准首个 allow option；否则 exit 5。"""
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    tool_id = _extract_tool_id(data)
    req = data.get("request_permission_request") or data.get("requestPermissionRequest") or {}
    if not isinstance(req, dict):
        req = {}
    options = req.get("options") or data.get("options") or []

    if args.auto_approve:
        allow = next(
            (o for o in options if "allow" in str(o.get("kind", "")).lower()), None
        )
        if allow:
            opt_id = allow.get("optionId") or allow.get("option_id")
            api_request(
                "POST",
                PERMISSION_RESPONSE_PATH,
                {
                    "conversationId": conv,
                    "toolId": tool_id,
                    "option": {"optionId": opt_id, "outcome": "selected"},
                },
            )
            print(
                f"[HITL] 已自动批准权限 (toolId={tool_id}, option={opt_id})",
                file=sys.stderr,
            )
            return
        print("[HITL] 权限请求无可批准的 allow option，需人工处理。", file=sys.stderr)

    # 列出 options，交给 approve.sh
    print(f"[HITL] 需要权限审批 (toolId={tool_id})", file=sys.stderr)
    print(f"  内容：{json.dumps(req, ensure_ascii=False)}", file=sys.stderr)
    for o in options:
        opt_id = o.get("optionId") or o.get("option_id")
        print(
            f"  option: id={opt_id} kind={o.get('kind')} name={o.get('name')}",
            file=sys.stderr,
        )
    print(
        f"  响应：./scripts/approve.sh --tool-id {tool_id} "
        f"--option-id <option_id> --outcome selected|cancelled",
        file=sys.stderr,
    )
    sys.exit(5)


def _handle_ask_question(event: dict, conv: str) -> None:
    """ask-question（PROCESSING+subEventType=ASK_QUESTION，nuwax_ask_question 工具）。

    无专用响应端点——答案作为普通 chat 消息回流（message 末尾带 marker）。
    故这里只输出 question + 提示用 debug.sh --ask-marker 续接。
    """
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    ask = result.get("data") if isinstance(result.get("data"), dict) else {}
    req_id = ask.get("requestId") or result.get("executeId") or data.get("tool_call_id") or ""
    title = ask.get("title", "")
    print(f"[HITL] ask-question (requestId={req_id}): {title}", file=sys.stderr)
    print(f"  内容：{json.dumps(ask, ensure_ascii=False)[:500]}", file=sys.stderr)
    print(
        f"  回答：./scripts/debug.sh --message \"<答案>\" --ask-marker {req_id}"
        + (f" --conversation {conv}" if conv else ""),
        file=sys.stderr,
    )
    sys.exit(5)


# === 主流程 =================================================================


def main() -> None:
    configure_stdio_utf8()

    p = argparse.ArgumentParser(
        description="真实调试目标 Agent（平台真实执行 + outcome 判定）"
    )
    p.add_argument("--message", default="", help="调试 prompt 文本")
    p.add_argument(
        "--message-file",
        default="",
        help="从 UTF-8 文件读取调试 prompt（含中文/长文本推荐）",
    )
    p.add_argument(
        "--conversation",
        default="",
        help="会话 ID（覆盖 CONVERSATION_ID env；默认挂到用户 agent-dev 预览会话）",
    )
    p.add_argument(
        "--expect-tool",
        default="",
        help="期望被调用的工具名子串（平台能力真实调用断言）",
    )
    p.add_argument(
        "--variables", default="", help="变量参数，JSON 字符串（传入 agent variables）"
    )
    p.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="SSE 单次读取超时秒数（idle：长时间无任何数据则断；SSE 有心跳一般不触发）",
    )
    p.add_argument(
        "--max-time",
        type=int,
        default=600,
        help="单次调试总时长上限秒数（0=不限）；超过主动中断，退出码 3。真实 agent 多轮执行可能较久，按需调大",
    )
    p.add_argument(
        "--show-trace", action="store_true", help="输出完整工具调用 trace"
    )
    p.add_argument(
        "--quiet", action="store_true", help="不回显流式文本（仅输出判定结果）"
    )
    p.add_argument(
        "--auto-approve",
        action="store_true",
        help="自动批准权限审批（ACP_REQUEST_PERMISSION），不中断执行",
    )
    p.add_argument(
        "--ask-marker",
        default="",
        help="回答 ask-question：把 <!--nuwax-mcp-ask-request-id:<requestId>--> 追加到 message 末尾",
    )
    args = p.parse_args()

    message = read_text_option(
        args.message or None, args.message_file or None, "message"
    )
    if not message.strip():
        print("[ERROR] --message 或 --message-file 必填且非空", file=sys.stderr)
        sys.exit(1)

    # 回答 ask-question：nuwax 约定答案作为普通消息回流，末尾带 requestId marker
    if args.ask_marker:
        message = message + f"\n<!--nuwax-mcp-ask-request-id:{args.ask_marker}-->"

    # 会话：优先 --conversation，其次沙箱注入的 CONVERSATION_ID（= 用户预览会话）
    conv = args.conversation or conversation_id() or ""
    # nuwax ConversationChatParams：conversationId + message + debug（agent-dev 调试语义）
    body: dict = {"message": message, "debug": True}
    if conv:
        body["conversationId"] = conv
    if args.variables:
        try:
            body["variables"] = json.loads(args.variables)
        except json.JSONDecodeError:
            print("[ERROR] --variables 必须是合法 JSON 对象", file=sys.stderr)
            sys.exit(1)

    if conv:
        print(
            f"[DEBUG] conversationId={conv}（执行将出现在用户 agent-dev 预览会话）",
            file=sys.stderr,
        )
    else:
        print(
            "[DEBUG] 未提供 conversationId；执行结果仅在此输出，不会出现在预览会话",
            file=sys.stderr,
        )

    # === SSE 流式收集（总时长上限 + 静默期进度反馈 + 流异常中断检测）===
    text_chunks: list[str] = []
    final_result = None
    errors: list[str] = []

    start = time.monotonic()
    last_activity = start  # 最近一次"可见活动"（文本/进度输出）的时间
    event_count = 0
    timed_out = False
    PROGRESS_INTERVAL = 30  # 静默超过此秒则输出进度心跳

    for event in sse_request(CHAT_PATH, body, timeout=args.timeout):
        event_count += 1
        now = time.monotonic()

        # 总时长上限：超过主动中断（防止 agent 卡死/跑过久时 dev-agent 干等）
        if args.max_time > 0 and (now - start) > args.max_time:
            print(
                f"\n[ERROR] 执行超时：已 {int(now - start)}s 超过 --max-time {args.max_time}s",
                file=sys.stderr,
            )
            timed_out = True
            break

        et = event.get("eventType", "")
        sub = event.get("subEventType", "")
        data = event.get("data")
        err = event.get("error")

        # HITL 人工介入
        # 1) 权限审批：ACP_REQUEST_PERMISSION，或 PROCESSING+subEventType=REQUEST_PERMISSION
        if et in PERMISSION_EVENT_TYPES or (
            et == "PROCESSING" and sub in PERMISSION_SUBEVENT_TYPES
        ):
            _handle_permission(event, args, conv)
            last_activity = time.monotonic()
            continue
        # 2) ask-question：PROCESSING+subEventType=ASK_QUESTION（无专用端点，exit 5 提示 --ask-marker）
        if et == "PROCESSING" and sub in ASK_QUESTION_SUBEVENT_TYPES:
            _handle_ask_question(event, conv)
            last_activity = time.monotonic()
            continue

        if et == "MESSAGE":
            chunk = extract_text(data)
            if chunk:
                if not args.quiet:
                    print(chunk, end="", flush=True)
                text_chunks.append(chunk)
                last_activity = now
        elif et == "FINAL_RESULT":
            final_result = data if isinstance(data, dict) else None
        elif et == "ERROR":
            errors.append(f"ERROR event: {err or 'unknown'}")

        # 静默期进度反馈：长时间无可见活动则输出心跳，让用户/dev-agent 知道没卡死
        if not args.quiet and (now - last_activity) >= PROGRESS_INTERVAL:
            elapsed = int(now - start)
            chars = sum(len(c) for c in text_chunks)
            tool_n = len(parse_tool_calls(final_result)) if final_result else 0
            print(
                f"\n[进度] 已 {elapsed}s | 事件 {event_count} | 文本 {chars} 字符"
                + (f" | 工具 {tool_n} 次" if tool_n else ""),
                file=sys.stderr,
            )
            last_activity = now

    if not args.quiet:
        print()

    # 超时：把已收集的内容摘要给出便于排查，退出码 3（未拿到结果）
    if timed_out:
        elapsed = int(time.monotonic() - start)
        print(
            f"[DEBUG] 超时（{elapsed}s）：已收集文本 {sum(len(c) for c in text_chunks)} 字符，"
            f"事件 {event_count}。可在预览会话查看部分输出，或调大 --max-time 重试。",
            file=sys.stderr,
        )
        sys.exit(3)

    # 流异常中断：没超时也没收到 FINAL_RESULT/ERROR → 连接意外结束
    if final_result is None and not errors:
        elapsed = int(time.monotonic() - start)
        print(
            f"[ERROR] SSE 流结束但未收到 FINAL_RESULT/ERROR（连接意外中断；{elapsed}s，"
            f"事件 {event_count}）。可能是后端重启/网络中断。",
            file=sys.stderr,
        )
        sys.exit(3)

    # === Outcome 判定 ===
    outcome = judge_outcome(final_result, text_chunks, errors, args.expect_tool)

    # 结构化结果走 stderr（stdout 留给 agent 文本回显）
    print(
        "[OUTCOME]", "FAIL" if outcome["failed"] else "PASS", file=sys.stderr
    )
    text_out = outcome["text_output"]
    if text_out:
        preview = text_out if len(text_out) <= 200 else text_out[:200] + "…"
        print(f"[text] {preview}", file=sys.stderr)
    if outcome["tool_calls"]:
        print(f"[tools] {len(outcome['tool_calls'])} 次调用", file=sys.stderr)
        if args.show_trace:
            for c in outcome["tool_calls"]:
                print(
                    f"  - {c['name']} (type={c['type']}, "
                    f"success={c['success']}, has_data={c['has_data']})",
                    file=sys.stderr,
                )

    if outcome["failed"]:
        print("[原因]", file=sys.stderr)
        print(
            aggregate_error_context(final_result, errors, outcome["tool_calls"]),
            file=sys.stderr,
        )
        sys.exit(4)
    sys.exit(0)


if __name__ == "__main__":
    main()
