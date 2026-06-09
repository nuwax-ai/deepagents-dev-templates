"""Config Schema — Pydantic models for the full AppConfig hierarchy.

Port of the TypeScript template's ``config-schema.ts`` (Zod schemas).
Defines the declarative layer: model, MCP, platform, permissions, sandbox,
skills, memory, agents, hooks, workspace, logging, compaction, eviction,
and middleware sections.

All fields use Pythonic snake_case names. CamelCase JSON aliases are
generated automatically so the on-disk JSON configs remain compatible
with the TypeScript template's format.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """Base model: accepts camelCase JSON keys but uses snake_case attributes."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


BUILTIN_TEMPLATE_CONFIGS: dict[str, dict[str, str]] = {
    "appAgent": {"path": "config/app-agent.config.json", "resourceBase": "."},
}

DEFAULT_BUILTIN_TEMPLATE_CONFIG: str = "appAgent"


class ModelSettingsConfig(_CamelModel):
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int | None = None


class ModelConfig(_CamelModel):
    provider: str = Field(default="anthropic")
    name: str = Field(default="claude-sonnet-4-6")
    base_url: str | None = None
    api_key_env: str = Field(default="ANTHROPIC_API_KEY")
    auth_token_env: str = Field(default="ANTHROPIC_AUTH_TOKEN")
    settings: ModelSettingsConfig = Field(default_factory=ModelSettingsConfig)


class MCPConfig(_CamelModel):
    config_path: str = Field(default="./config/mcp.default.json")
    config_paths: list[str] = Field(default_factory=list)
    servers: dict[str, Any] = Field(default_factory=dict)
    merge_strategy: str = Field(default="session-wins")


class PlatformEndpointConfig(_CamelModel):
    method: str = Field(default="POST")
    path: str = Field(default="")


class PlatformEndpointsConfig(_CamelModel):
    save_prompt: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(path="/api/agent/config/update")
    )
    query_plugins: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(
            method="GET", path="/api/agent/component/search"
        )
    )
    bind_component: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(path="/api/agent/component/add")
    )
    list_components: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(
            method="GET", path="/api/agent/component/list/{agentId}"
        )
    )
    create_variable: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(path="/api/agent/variable/add")
    )
    update_variable: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(path="/api/agent/variable/update")
    )
    list_variables: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(
            method="GET", path="/api/agent/variable/list/{agentId}"
        )
    )
    execute_plugin: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(path="/api/v1/plugin/{pluginId}/execute")
    )
    execute_workflow: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(path="/api/v1/workflow/{workflowId}/execute")
    )
    create_debug_session: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(path="/api/agent/debug/session")
    )
    get_debug_session: PlatformEndpointConfig = Field(
        default_factory=lambda: PlatformEndpointConfig(
            method="GET", path="/api/agent/debug/session/{sessionId}"
        )
    )


class PlatformConfig(_CamelModel):
    api_base_url: str = Field(default="https://api.nuwax.com")
    agent_id: str = Field(default="")
    space_id: str = Field(default="")
    endpoints: PlatformEndpointsConfig = Field(default_factory=PlatformEndpointsConfig)


class PermissionsConfig(_CamelModel):
    mode: str = Field(default="ask")
    interrupt_on: list[str] = Field(
        default_factory=lambda: ["write_file", "edit_file", "execute"]
    )
    allowed_paths: list[str] = Field(
        default_factory=lambda: ["src/app/", "prompts/", "skills/", "config/"]
    )
    denied_paths: list[str] = Field(
        default_factory=lambda: ["src/runtime/", "src/surfaces/"]
    )


class SandboxEnvironmentConfig(_CamelModel):
    allowed_env: list[str] = Field(
        default_factory=lambda: [
            "LLM_PROVIDER",
            "OPENAI_MODEL",
            "OPENAI_BASE_URL",
            "ANTHROPIC_MODEL",
            "ANTHROPIC_BASE_URL",
            "MAX_TOKENS",
            "LOG_LEVEL",
            "LOG_DIR",
        ]
    )
    secret_env: list[str] = Field(
        default_factory=lambda: [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "PLATFORM_API_TOKEN",
        ]
    )


class SandboxConfig(_CamelModel):
    profile: str = Field(default="custom")
    writable_paths: list[str] = Field(
        default_factory=lambda: ["src/app/", "prompts/", "skills/", "config/"]
    )
    denied_write_paths: list[str] = Field(
        default_factory=lambda: ["src/runtime/", "src/surfaces/"]
    )
    environment: SandboxEnvironmentConfig = Field(
        default_factory=SandboxEnvironmentConfig
    )


class SkillsConfig(_CamelModel):
    directories: list[str] = Field(
        default_factory=lambda: [
            "~/.deepagents/skills",
            "./.deepagents/skills",
            "./skills/builtin/",
            "./skills/platform/",
        ]
    )
    progressive_loading: bool = Field(default=True)


class MemoryConfig(_CamelModel):
    enabled: bool = Field(default=True)
    dir: str = Field(default="~/.deepagents/workspaces")
    add_cache_control: bool = Field(default=True)


class AgentConfig(_CamelModel):
    name: str = Field(default="deepagents-template")
    description: str = Field(default="DeepAgents Python application agent")
    version: str = Field(default="0.1.1")
    output_style: str = Field(default="concise")
    system_prompt: str | None = None
    system_prompt_path: str = Field(default="prompts/developer-agent.system.md")
    include_workspace_instructions: bool = Field(default=True)


class HookConfig(_CamelModel):
    event: str
    matcher: str | None = None
    command: str
    timeout_ms: int = Field(default=30_000)
    priority: int = Field(default=0)
    scope: str | None = None


class WorkspaceConfig(_CamelModel):
    working_dir: str | None = None


class LoggingConfig(_CamelModel):
    level: str = Field(default="info")
    structured: bool = Field(default=True)


class CompactionConfig(_CamelModel):
    enabled: bool = Field(default=True)
    context_window: int = Field(default=200_000)
    trigger_threshold: float = Field(default=0.8, ge=0.1, le=0.95)
    reserve_tokens: int = Field(default=16_384)
    keep_recent_tokens: int = Field(default=20_000)
    summarizer_model: str | None = None


class EvictionConfig(_CamelModel):
    enabled: bool = Field(default=True)
    token_limit: int = Field(default=20_000)
    char_per_token: float = Field(default=4.0)
    head_lines: int = Field(default=5)
    tail_lines: int = Field(default=5)
    eviction_path: str = Field(default="/large_tool_results")


class PluginsConfig(_CamelModel):
    directories: list[str] = Field(
        default_factory=lambda: ["~/.deepagents/plugins", "./.deepagents/plugins"]
    )
    enabled: list[str] = Field(default_factory=list)
    disabled: list[str] = Field(default_factory=list)


class StuckLoopDetectionConfig(_CamelModel):
    enabled: bool = Field(default=True)
    threshold: int = Field(default=3, ge=2, le=10)
    mode: str = Field(default="warn")


class PeriodicReminderConfig(_CamelModel):
    enabled: bool = Field(default=True)
    first_at: int = Field(default=5, ge=1)
    every: int = Field(default=10, ge=1)


class CostTrackingConfig(_CamelModel):
    enabled: bool = Field(default=True)
    warn_at_tokens: int = Field(default=100_000, ge=1_000)


class MiddlewareConfig(_CamelModel):
    stuck_loop_detection: StuckLoopDetectionConfig = Field(
        default_factory=StuckLoopDetectionConfig
    )
    periodic_reminder: PeriodicReminderConfig = Field(
        default_factory=PeriodicReminderConfig
    )
    cost_tracking: CostTrackingConfig = Field(default_factory=CostTrackingConfig)


class AppConfig(_CamelModel):
    model: ModelConfig = Field(default_factory=ModelConfig)
    mcp: MCPConfig = Field(default_factory=MCPConfig)
    platform: PlatformConfig = Field(default_factory=PlatformConfig)
    permissions: PermissionsConfig = Field(default_factory=PermissionsConfig)
    sandbox: SandboxConfig = Field(default_factory=SandboxConfig)
    skills: SkillsConfig = Field(default_factory=SkillsConfig)
    agents_directories: list[str] = Field(
        default_factory=lambda: ["~/.deepagents", "./.deepagents", "./.agents"]
    )
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    hooks: list[HookConfig] = Field(default_factory=list)
    plugins: PluginsConfig = Field(default_factory=PluginsConfig)
    workspace: WorkspaceConfig = Field(default_factory=WorkspaceConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    compaction: CompactionConfig = Field(default_factory=CompactionConfig)
    eviction: EvictionConfig = Field(default_factory=EvictionConfig)
    middleware: MiddlewareConfig = Field(default_factory=MiddlewareConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)


class ACPSessionConfig(_CamelModel):
    model: str | None = None
    agent_id: str | None = None
    space_id: str | None = None
    cwd: str | None = None
    system_prompt: str | None = None

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="allow",
    )
