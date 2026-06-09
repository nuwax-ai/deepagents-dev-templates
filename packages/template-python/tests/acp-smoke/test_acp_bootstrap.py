"""Smoke tests for ACP server bootstrap."""

from __future__ import annotations


def test_acp_import():
    from deepagents_template.surfaces.acp.server import bootstrap
    assert bootstrap is not None
