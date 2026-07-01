"""dev-engineer-toolkit 共用：UTF-8 安全的 4sandbox/agent/dev HTTP 调用。"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API_PREFIX = "/api/v1/4sandbox/agent/dev"


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
    if status == 404:
        print("[ERROR] 当前项目不存在。", file=sys.stderr)
        sys.exit(3)
    if status != 200:
        print(f"[ERROR] API 返回 HTTP 错误 ({status}):", file=sys.stderr)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(3)
    code = payload.get("code", "")
    if code != "0000":
        msg = payload.get("message", "")
        print(f"[ERROR] 业务错误 (code={code}): {msg}", file=sys.stderr)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(4)
    return payload
