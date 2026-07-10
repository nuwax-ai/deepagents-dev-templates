"""flow-debugger 共用：UTF-8 安全的 4sandbox/agent HTTP + SSE 调用。

端点契约集中在本文件顶部常量。后端会话接口经沙箱重写（application.yml: agent/conversation/**）
转发到内部 /api/agent/conversation/*；agent 配置接口直接暴露在 4sandbox。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

# === 端点契约（后端 ready 后只改这里）======================================
API_PREFIX = "/api/v1/4sandbox/agent"
# agent 配置接口（直接暴露）：GET 返回 agent 配置，含 devConversationId = 调试会话 ID
AGENT_CONFIG_PATH = "/{devAgentId}"
# 会话接口（经沙箱重写 agent/conversation/** → 内部 /api/agent/conversation/*）
CHAT_PATH = "/conversation/chat"                                       # POST(SSE) 发消息（conversationId 用 devConversationId）
CONVERSATION_CREATE_PATH = "/conversation/create"                      # 平台 UI「刷子」创建；flow-debugger **不调用**，用 GET devConversationId
CONVERSATION_DETAIL_PATH = "/conversation/{conversationId}"            # POST 会话内容/初始历史
CONVERSATION_STOP_PATH = "/conversation/chat/stop/{conversationId}"    # POST 取消（路径参=conversationId，无 body）
PERMISSION_RESPONSE_PATH = "/conversation/chat/permission-request/response"  # POST 权限审批响应
MESSAGE_LIST_PATH = "/conversation/message/list"                       # POST 分页历史
FINAL_EVENT_TYPES = ("FINAL_RESULT", "ERROR")  # 收到即终止 SSE 流
# HITL 事件识别在 debug.py（_is_permission_event / _is_ask_question_event），
# 兼容后端多形态（subType 顶层 / data 内 / snake_case），对齐平台 parseSseEventEnvelope。
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


def fetch_dev_conversation_id() -> str | None:
    """GET /{devAgentId} → data.devConversationId（agent-dev 预览会话权威 ID）。"""
    val = os.environ.get("DEV_AGENT_ID", "").strip()
    if not val:
        return None
    try:
        aid = int(val)
    except ValueError:
        return None
    if not os.environ.get("PLATFORM_BASE_URL") or not os.environ.get("SANDBOX_ACCESS_KEY"):
        return None
    path = AGENT_CONFIG_PATH.replace("{devAgentId}", str(aid))
    try:
        status, payload = api_request("GET", path)
    except SystemExit:
        return None
    if status != 200:
        return None
    code = payload.get("code", "")
    success = payload.get("success")
    if (code and code != "0000") or success is False:
        return None
    data = payload.get("data") or {}
    raw = data.get("devConversationId")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def resolve_conversation_id(explicit: str | None = None) -> str | None:
    """解析 conversationId：--conversation > GET devConversationId > CONVERSATION_ID env。"""
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    fetched = fetch_dev_conversation_id()
    env_val = os.environ.get("CONVERSATION_ID", "").strip()
    if fetched:
        if env_val and env_val != fetched:
            print(
                f"[DEBUG] CONVERSATION_ID env={env_val} 与 agent devConversationId={fetched} 不一致，使用 devConversationId",
                file=sys.stderr,
            )
        return fetched
    return env_val or None


def fetch_dev_conversation_id_strict() -> str:
    """GET /{devAgentId} → data.devConversationId；失败或为空则 exit。"""
    aid = dev_agent_id()
    path = AGENT_CONFIG_PATH.replace("{devAgentId}", str(aid))
    status, payload = api_request("GET", path)
    ensure_http_ok(status, payload)
    data = payload.get("data") or {}
    cid = str(data.get("devConversationId") or "").strip()
    if not cid:
        print("[ERROR] agent 配置中 devConversationId 为空。", file=sys.stderr)
        sys.exit(4)
    return cid


def conversation_id() -> str | None:
    """读调试会话 ID（优先 agent 配置中的 devConversationId）。

    沙箱可能注入过期的 CONVERSATION_ID；发 message 应以 GET /{devAgentId} 返回的
    devConversationId 为准，执行才会出现在用户 agent-dev 预览面板。
    """
    return resolve_conversation_id()


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
    """检查同步 HTTP 响应：status==200 且业务成功（平台 RequestResponse：code=="0000" 或 success==true）。"""
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


def _event_sub_type(event: dict) -> str:
    data = event.get("data")
    nested = data if isinstance(data, dict) else {}
    return (
        str(event.get("subType") or event.get("sub_type") or event.get("subEventType") or "")
        or str(nested.get("subType") or nested.get("sub_type") or nested.get("subEventType") or "")
    )


def is_terminal_event(event: dict) -> bool:
    """平台 SSE 终止信号：FINAL_RESULT / ERROR / completed=true / end_turn。"""
    if event.get("eventType") in FINAL_EVENT_TYPES:
        return True
    if event.get("completed") is True:
        return True
    return _event_sub_type(event) == "end_turn"


def sse_request(path: str, body: dict, timeout: int = 180):
    """流式 SSE 请求，逐事件 yield 解析后的 dict。

    与 api_request 的差异：Accept: text/event-stream；逐行读取 `data:` 前缀的 JSON 事件；
    遇 FINAL_RESULT / ERROR / completed=true / end_turn 终止。后端执行端点返回 Flux<AgentOutputDto> 的 SSE。
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
                if is_terminal_event(event):
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
                f"(POST {API_PREFIX}{CHAT_PATH})；请确认后端已将该 agent 会话接口转到 4sandbox。",
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
