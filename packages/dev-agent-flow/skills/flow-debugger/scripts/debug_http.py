"""flow-debugger 共用：UTF-8 安全的 4sandbox/agent/dev HTTP + SSE 调用。

端点契约集中在本文件顶部常量；后端 4sandbox 会话执行接口 ready 后若路径/字段有差异，
只需改这里的常量即可，无需动 debug.py。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

# === 端点契约（后端 ready 后只改这里）======================================
API_PREFIX = "/api/v1/4sandbox/agent/dev"
# 严格镜像 nuwax 前端 /api/agent/conversation/* 子路径（仅前缀换到 4sandbox）。
# 后端把 agent 会话接口转到 4sandbox 后子路径应与 nuwax 一致；若不同只改这里。
CHAT_PATH = "/conversation/chat"                                    # POST(SSE) 发消息
CONVERSATION_CREATE_PATH = "/conversation/create"                   # POST 新建会话（agent-dev「刷子」）
CONVERSATION_DETAIL_PATH = "/conversation/{conversationId}"         # POST 会话内容/初始历史
CONVERSATION_STOP_PATH = "/conversation/chat/stop/{conversationId}" # POST 取消（路径参=conversationId，无 body）
PERMISSION_RESPONSE_PATH = "/conversation/chat/permission-request/response"  # POST 权限审批响应
MESSAGE_LIST_PATH = "/conversation/message/list"                    # POST 分页历史
FINAL_EVENT_TYPES = ("FINAL_RESULT", "ERROR")  # 收到即终止 SSE 流
# HITL：权限审批（顶层 ACP_REQUEST_PERMISSION；也可能 PROCESSING+subEventType=REQUEST_PERMISSION）
PERMISSION_EVENT_TYPES = ("ACP_REQUEST_PERMISSION",)
PERMISSION_SUBEVENT_TYPES = ("REQUEST_PERMISSION",)
# ask-question：PROCESSING 事件 + subEventType=ASK_QUESTION（nuwax_ask_question 工具，无专用响应端点）
ASK_QUESTION_SUBEVENT_TYPES = ("ASK_QUESTION",)
# ===========================================================================


def configure_stdio_utf8() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass


def require_env(name: str) -> str:
    val = os.environ.get(name, "")
    if not val:
        print("[ERROR] 平台运行时未就绪，请确认在沙箱环境中执行。", file=sys.stderr)
        sys.exit(2)
    return val


def dev_agent_id() -> int:
    val = require_env("DEV_AGENT_ID")
    try:
        return int(val)
    except ValueError:
        print("[ERROR] 项目标识无效。", file=sys.stderr)
        sys.exit(1)


def conversation_id() -> str | None:
    """读沙箱注入的 CONVERSATION_ID。

    该值 = dev-agent 当前所在的 DevDebug 会话 = 用户在 nuwax agent-dev 页面预览
    业务 Agent 的那个会话（业务 Agent 的 devAgentConversationId）。把它作为
    conversationId 传给后端执行端点，执行消息会写入该会话，用户即可在预览面板看到输出。
    本地无沙箱时返回 None（此时执行结果仅在本地输出，不会出现在预览会话）。
    """
    val = os.environ.get("CONVERSATION_ID", "")
    return val or None


def read_text_option(text: str | None, file_path: str | None, label: str) -> str:
    if text and file_path:
        print(f"[ERROR] {label} 不能同时指定文本与文件。", file=sys.stderr)
        sys.exit(1)
    if file_path:
        if file_path == "-":
            return sys.stdin.read()
        path = os.path.abspath(file_path)
        if not os.path.isfile(path):
            print(f"[ERROR] 文件不存在: {file_path}", file=sys.stderr)
            sys.exit(1)
        with open(path, encoding="utf-8-sig") as f:
            return f.read()
    return text or ""


def api_request(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    base = require_env("PLATFORM_BASE_URL")
    token = require_env("SANDBOX_ACCESS_KEY")
    url = f"{base}{API_PREFIX}{path}"
    data = (
        json.dumps(body, ensure_ascii=False).encode("utf-8")
        if body is not None
        else None
    )
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, errors="replace")
            return resp.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        err_raw = e.read()
        try:
            payload = json.loads(err_raw.decode("utf-8"))
        except Exception:
            payload = {"message": err_raw.decode("utf-8", errors="replace")}
        return e.code, payload
    except urllib.error.URLError as e:
        print(f"[ERROR] API 请求失败：无法连接到平台。{e.reason}", file=sys.stderr)
        sys.exit(3)


def ensure_http_ok(status: int, payload: dict) -> dict:
    """检查同步 HTTP 响应：status==200 且业务成功（nuwax RequestResponse：code=="0000" 或 success==true）。"""
    if status == 404:
        print("[ERROR] 端点未就绪或资源不存在 (404)。", file=sys.stderr)
        print(
            "[提示] 若后端 4sandbox 会话接口尚在开发，待 ready 后重试；"
            "路径见 debug_http.py 顶部常量。",
            file=sys.stderr,
        )
        sys.exit(3)
    if status != 200:
        print(f"[ERROR] API 返回 HTTP 错误 ({status}):", file=sys.stderr)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(3)
    code = payload.get("code", "")
    success = payload.get("success", None)
    if (code and code != "0000") or success is False:
        msg = payload.get("message", "") or payload.get("error", "")
        print(f"[ERROR] 业务错误 (code={code}, success={success}): {msg}", file=sys.stderr)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(4)
    return payload


def sse_request(path: str, body: dict, timeout: int = 180):
    """流式 SSE 请求，逐事件 yield 解析后的 dict。

    与 api_request 的差异：Accept: text/event-stream；逐行读取 `data:` 前缀的 JSON 事件；
    遇 FINAL_RESULT / ERROR 终止。后端执行端点返回 Flux<AgentOutputDto> 的 SSE。
    """
    base = require_env("PLATFORM_BASE_URL")
    token = require_env("SANDBOX_ACCESS_KEY")
    url = f"{base}{API_PREFIX}{path}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if not payload:
                    continue
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                yield event
                if event.get("eventType") in FINAL_EVENT_TYPES:
                    return
    except urllib.error.HTTPError as e:
        err_raw = e.read()
        print(
            f"[ERROR] HTTP {e.code}: {err_raw.decode('utf-8', errors='replace')}",
            file=sys.stderr,
        )
        if e.code == 404:
            print(
                "[提示] 后端 4sandbox 会话执行接口可能尚未就绪 "
                f"(POST {API_PREFIX}{EXECUTE_PATH})；请确认后端已将该 agent 会话接口转到 4sandbox。",
                file=sys.stderr,
            )
        sys.exit(3)
    except urllib.error.URLError as e:
        reason = e.reason
        # socket.timeout / TimeoutError → 读取超时（idle：长时间无数据，连接可能挂起）
        is_timeout = isinstance(reason, TimeoutError) or "timed out" in str(reason).lower()
        if is_timeout:
            print(
                f"[ERROR] 读取超时：{timeout}s 内无数据（连接可能挂起或后端无响应）；"
                "可调大 --timeout 或 --max-time。",
                file=sys.stderr,
            )
        else:
            print(f"[ERROR] 无法连接平台：{reason}", file=sys.stderr)
        sys.exit(3)
