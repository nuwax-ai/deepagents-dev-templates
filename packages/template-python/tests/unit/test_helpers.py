"""Unit tests for runtime helpers."""

from __future__ import annotations

from deepagents_template.runtime.string import slugify, truncate


def test_slugify():
    assert slugify("Hello World") == "hello-world"
    assert slugify("Test!!! 123") == "test-123"
    assert slugify("___") == "agent"


def test_truncate():
    assert truncate("hello", limit=10) == "hello"
    assert truncate("hello world", limit=8) == "hello w…"
    # limit=2 with "hi!" (len=3): truncates to 1 char + "…"
    assert truncate("hi!", limit=2) == "h…"
    # string fits within limit, returns unchanged
    assert truncate("hi", limit=2) == "hi"
    assert truncate("hello world", limit=6) == "hello…"
