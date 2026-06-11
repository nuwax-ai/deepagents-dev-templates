"""JSON utils tool — parse, format, merge, and validate JSON."""

from __future__ import annotations

import json

from langchain_core.tools import tool


@tool
def json_utils(operation: str, json_input: str, other: str | None = None) -> str:
    """JSON utilities.

    Args:
        operation: One of ``parse`` (pretty-print), ``stringify`` (compact),
            ``merge`` (shallow-merge two JSON objects), ``validate``.
        json_input: The JSON text to operate on.
        other: A second JSON object (required for ``merge``).
    """
    try:
        if operation == "validate":
            json.loads(json_input)
            return "valid JSON"
        if operation == "parse":
            return json.dumps(json.loads(json_input), indent=2, ensure_ascii=False)
        if operation == "stringify":
            return json.dumps(json.loads(json_input), ensure_ascii=False)
        if operation == "merge":
            a = json.loads(json_input)
            b = json.loads(other or "{}")
            if isinstance(a, dict) and isinstance(b, dict):
                return json.dumps({**a, **b}, indent=2, ensure_ascii=False)
            return "merge requires two JSON objects"
    except json.JSONDecodeError as exc:
        return f"invalid JSON: {exc}"
    return f"unknown operation: {operation!r} (use parse|stringify|merge|validate)"
