"""Tests for slash command registry and routing."""

from __future__ import annotations

import pytest

from deepagents_acp_py.slash_commands import SlashCommandRegistry


@pytest.fixture
def registry() -> SlashCommandRegistry:
    return SlashCommandRegistry()


class TestBuiltinCommands:
    async def test_help_command(self, registry: SlashCommandRegistry) -> None:
        result = await registry.handle("/help", {})
        assert result is not None
        assert "Available commands" in result
        assert "/help" in result

    async def test_status_command(self, registry: SlashCommandRegistry) -> None:
        result = await registry.handle(
            "/status",
            {"session_id": "abc", "model": "test", "message_count": 5},
        )
        assert result is not None
        assert "abc" in result
        assert "test" in result

    async def test_clear_command(self, registry: SlashCommandRegistry) -> None:
        result = await registry.handle("/clear", {})
        assert "cleared" in result.lower()


class TestDetection:
    def test_is_slash_command(self, registry: SlashCommandRegistry) -> None:
        assert registry.is_slash_command("/help")
        assert registry.is_slash_command("/clear")
        assert not registry.is_slash_command("hello")
        assert not registry.is_slash_command("/unknown_cmd")

    async def test_unknown_command(self, registry: SlashCommandRegistry) -> None:
        result = await registry.handle("/unknown", {})
        assert "Unknown command" in result

    async def test_non_slash_returns_none(self, registry: SlashCommandRegistry) -> None:
        result = await registry.handle("just text", {})
        assert result is None


class TestCustomCommands:
    async def test_register_custom(self, registry: SlashCommandRegistry) -> None:
        async def my_handler(text: str, ctx: dict) -> str:
            return f"Custom: {text}"

        registry.register_command("custom", "My custom command", my_handler)
        assert registry.is_slash_command("/custom")
        result = await registry.handle("/custom arg1", {})
        assert "Custom: /custom arg1" in result

    def test_list_specs(self, registry: SlashCommandRegistry) -> None:
        specs = registry.list_specs()
        names = [s["name"] for s in specs]
        # ACP AvailableCommand.name uses bare names (no leading slash)
        assert "help" in names
        assert "clear" in names
        assert "status" in names
        # Make sure no spec has a leading slash
        for spec in specs:
            assert not spec["name"].startswith("/")
