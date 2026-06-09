"""Deep merge — generic recursive object merge (source wins).

Port of the TS ``deep-merge.ts``. Used by the config system and also
reusable by app-level tools (e.g., json-utils).
"""

from __future__ import annotations

from typing import Any


def deepMerge(target: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    """Deep merge two dicts (source wins for scalar/array values)."""
    result = dict(target)
    for key, source_val in source.items():
        if source_val is None:
            continue
        target_val = result.get(key)
        if (
            isinstance(source_val, dict)
            and isinstance(target_val, dict)
        ):
            result[key] = deepMerge(target_val, source_val)
        else:
            result[key] = source_val
    return result
