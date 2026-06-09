"""Unit tests for the config system."""

from __future__ import annotations

from deepagents_template.runtime.config.config_schema import AppConfig


def test_app_config_defaults():
    config = AppConfig()
    assert config.agent.name == "deepagents-template"
    assert config.model.provider == "anthropic"
    assert config.permissions.mode == "ask"
    assert config.compaction.enabled is True
    assert config.eviction.enabled is True


def test_app_config_custom():
    config = AppConfig(**{
        "agent": {"name": "custom-agent"},
        "model": {"provider": "openai", "name": "gpt-4"},
    })
    assert config.agent.name == "custom-agent"
    assert config.model.provider == "openai"
    assert config.model.name == "gpt-4"
