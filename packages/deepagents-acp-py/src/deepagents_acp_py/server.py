"""DeepAgentsServer — ACP server for Python agents.

Implements the ``acp.Agent`` protocol to provide a high-level ACP server
that bridges Python agents with the Agent Client Protocol for IDE integration
(Zed, JetBrains, etc.).

Framework-agnostic: accepts any agent object or factory callable. If the agent
has an ``.iter()`` method (pydantic-ai style), streaming is enabled automatically.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from typing import Any
from uuid import uuid4

from acp import (
    Agent as ACPAgent,
)
from acp import (
    InitializeResponse,
    NewSessionResponse,
    PromptResponse,
    SetSessionConfigOptionResponse,
    SetSessionModeResponse,
    start_tool_call,
    text_block,
    tool_content,
    update_agent_message,
    update_agent_message_text,
    update_tool_call,
)
from acp.helpers import AvailableCommand, update_available_commands
from acp.interfaces import Client
from acp.schema import (
    AgentCapabilities,
    ClientCapabilities,
    Implementation,
    PromptCapabilities,
    SessionConfigOptionSelect,
    SessionConfigSelectOption,
)

from deepagents_acp_py._version import __version__
from deepagents_acp_py.helpers import DEFAULT_TOOL_KIND_MAP, extract_prompt_text
from deepagents_acp_py.mcp_bridge import convert_acp_mcp_servers
from deepagents_acp_py.session import SessionContext, SessionManager
from deepagents_acp_py.slash_commands import SlashCommand, SlashCommandRegistry

logger = logging.getLogger(__name__)


class DeepAgentsServer(ACPAgent):
    """ACP server that bridges Python agents with the Agent Client Protocol.

    Supports both static agents and agent factories (for model switching)::

        # Static agent
        server = DeepAgentsServer(agent=my_agent)

        # Factory (per-session agent creation)
        def build_agent(ctx: SessionContext):
            return create_my_agent(model=ctx.model, cwd=ctx.cwd)

        server = DeepAgentsServer(
            agent=build_agent,
            models=[
                {"value": "anthropic:claude-sonnet-4-6", "name": "Claude Sonnet 4.6"},
            ],
        )
    """

    _conn: Client

    def __init__(
        self,
        agent: Any | Callable[[SessionContext], Any],
        *,
        name: str = "deepagents-acp-py",
        version: str | None = None,
        models: list[dict[str, str]] | None = None,
        commands: list[dict[str, str]] | None = None,
        workspace_root: str | None = None,
        tool_kind_map: dict[str, str] | None = None,
        debug: bool = False,
    ) -> None:
        super().__init__()
        self._agent_factory = agent
        self._static_agent: Any | None = agent if not callable(agent) else None
        self._name = name
        self._version = version or __version__
        self._models = models or []
        self._workspace_root = workspace_root
        self._debug = debug
        self._tool_kind_map = {**DEFAULT_TOOL_KIND_MAP, **(tool_kind_map or {})}

        # Session management
        self._session_mgr = SessionManager()

        # Slash commands
        self._slash_cmds = SlashCommandRegistry()
        if commands:
            for cmd in commands:
                self._slash_cmds.register(
                    SlashCommand(
                        name=cmd["name"],
                        description=cmd.get("description", ""),
                        handler=self._make_passthrough_command(cmd["name"]),
                    )
                )

    # ── Convenience for custom commands ──────────────────────────────

    @staticmethod
    def _make_passthrough_command(name: str) -> Any:
        """Create a simple passthrough handler that returns the command name."""
        async def _handler(text: str, ctx: dict[str, Any]) -> str:
            return f"Command /{name} received."
        return _handler

    def register_command(
        self,
        name: str,
        description: str,
        handler: Callable[[str, dict[str, Any]], Any],
    ) -> None:
        """Register a custom slash command at runtime."""
        self._slash_cmds.register_command(name, description, handler)

    # ── ACP Lifecycle ────────────────────────────────────────────────

    def on_connect(self, conn: Client) -> None:
        """Store the client connection."""
        self._conn = conn

    # ── ACP Protocol Methods ─────────────────────────────────────────

    async def initialize(
        self,
        protocol_version: int,
        client_capabilities: ClientCapabilities,
        client_info: Implementation | None = None,
    ) -> InitializeResponse:
        """Handle ACP initialize request."""
        logger.info(
            "ACP initialize: protocol=%d client=%s",
            protocol_version,
            client_info,
        )
        return InitializeResponse(
            protocolVersion=protocol_version,
            agentInfo=Implementation(
                name=self._name,
                version=self._version,
            ),
            agentCapabilities=AgentCapabilities(
                prompt_capabilities=PromptCapabilities(
                    image=True,
                ),
            ),
        )

    async def new_session(
        self,
        cwd: str,
        mcp_servers: list[Any] | None = None,
        **kwargs: Any,
    ) -> NewSessionResponse:
        """Create a new ACP session."""
        session_id = uuid4().hex[:12]
        ctx = SessionContext(
            session_id=session_id,
            cwd=cwd or self._workspace_root or ".",
            model=self._models[0]["value"] if self._models else None,
        )

        # Convert ACP MCP servers if provided
        if mcp_servers:
            ctx.extra["mcp_servers"] = convert_acp_mcp_servers(mcp_servers)

        self._session_mgr.track(ctx)
        self.on_session_created(ctx)

        logger.info("New session: %s cwd=%s", session_id, ctx.cwd)

        # Send available commands notification after session creation
        cmd_specs = self._slash_cmds.list_specs()
        if cmd_specs:
            try:
                commands = [
                    AvailableCommand(name=spec["name"], description=spec["description"])
                    for spec in cmd_specs
                ]
                await self._conn.session_update(
                    session_id=session_id,
                    update=update_available_commands(commands),
                    source=self._name,
                )
            except Exception:
                logger.debug("Could not send commands update (no conn yet)")

        return NewSessionResponse(
            sessionId=session_id,
            configOptions=self._build_config_options(session_id),
        )

    async def load_session(
        self,
        session_id: str,
        **kwargs: Any,
    ) -> Any:
        """Load a previous session. Returns None if not found."""
        ctx = self._session_mgr.get(session_id)
        if ctx is None:
            return None
        ctx.touch()
        return None

    async def list_sessions(
        self,
        **kwargs: Any,
    ) -> Any:
        """List active sessions."""
        sessions = self._session_mgr.list()
        return {
            "sessions": [
                {"sessionId": s.session_id, "cwd": s.cwd}
                for s in sessions
            ],
        }

    async def set_session_mode(
        self,
        mode_id: str,
        session_id: str,
        **kwargs: Any,
    ) -> SetSessionModeResponse:
        """Handle mode change."""
        ctx = self._session_mgr.get(session_id)
        if ctx is not None:
            ctx.mode = mode_id
            ctx.touch()
        return SetSessionModeResponse()

    async def set_session_model(
        self,
        model_id: str,
        session_id: str,
        **kwargs: Any,
    ) -> Any:
        """Handle model switch — resets cached agent for factory pattern."""
        ctx = self._session_mgr.get(session_id)
        if ctx is not None:
            ctx.model = model_id
            ctx.invalidate_agent()
            ctx.touch()
        return None

    async def set_config_option(
        self,
        config_id: str,
        session_id: str,
        value: str | bool,
        **kwargs: Any,
    ) -> SetSessionConfigOptionResponse:
        """Handle config option change (e.g. model selector)."""
        if config_id == "model" and isinstance(value, str):
            ctx = self._session_mgr.get(session_id)
            if ctx is not None:
                ctx.model = value
                ctx.invalidate_agent()
                ctx.touch()
        return SetSessionConfigOptionResponse(
            configOptions=self._build_config_options(session_id),
        )

    async def close_session(
        self,
        session_id: str,
        **kwargs: Any,
    ) -> Any:
        """Close and clean up a session."""
        ctx = self._session_mgr.close(session_id)
        if ctx is not None:
            self.on_session_closed(ctx)
        return None

    async def cancel(self, session_id: str, **kwargs: Any) -> None:
        """Cancel current operation for a specific session."""
        ctx = self._session_mgr.get(session_id)
        if ctx is not None:
            ctx.cancelled = True
            ctx.touch()
        logger.info("Session %s cancelled", session_id)

    async def prompt(  # noqa: C901
        self,
        prompt: list[Any],
        session_id: str,
        message_id: str | None = None,
        **kwargs: Any,
    ) -> PromptResponse:
        """Handle a user prompt — run the agent and stream results."""
        session_id = session_id or "default"

        # Extract text from prompt blocks
        user_text = extract_prompt_text(prompt)
        if not user_text:
            return PromptResponse(stopReason="end_turn")

        ctx = self._session_mgr.get(session_id)
        if ctx is None:
            # Auto-create session for stale recovery
            ctx = SessionContext(session_id=session_id)
            self._session_mgr.track(ctx)

        # Reset per-session cancel flag at the start of each turn
        ctx.cancelled = False

        ctx.message_count += 1
        ctx.touch()

        # ── Slash command intercept ──────────────────────────────────
        if self._slash_cmds.is_slash_command(user_text):
            cmd_ctx = {
                "session_id": session_id,
                "cwd": ctx.cwd,
                "model": ctx.model,
                "message_count": ctx.message_count,
            }
            response_text = await self._slash_cmds.handle(user_text, cmd_ctx)
            if response_text is not None:
                await self._send_text(session_id, response_text)
                return PromptResponse(stopReason="end_turn")

        # ── Run agent ────────────────────────────────────────────────
        agent = self._get_or_create_agent(ctx)

        # Helper to send updates
        async def send(update: Any) -> None:
            await self._conn.session_update(
                session_id=session_id, update=update, source=self._name,
            )

        try:
            # Check if agent supports streaming (.iter() from pydantic-ai)
            if hasattr(agent, "iter") and callable(agent.iter):
                await self._run_streaming(agent, ctx, user_text, send)
            elif callable(agent):
                # Simple callable
                if asyncio.iscoroutinefunction(agent):
                    result = await agent(user_text)
                else:
                    result = agent(user_text)
                if result:
                    await send(update_agent_message(text_block(str(result))))
            else:
                await send(update_agent_message(text_block("Agent returned no output.")))

        except Exception as e:
            logger.exception("Agent run failed: %s", e)
            await send(update_agent_message(text_block(f"Error: {e}")))

        return PromptResponse(stopReason="end_turn")

    # ── Agent Management ─────────────────────────────────────────────

    def _get_or_create_agent(self, ctx: SessionContext) -> Any:
        """Get the static agent or use a cached factory result for the session.

        For factory agents, the agent is cached on the SessionContext and only
        rebuilt when the session's model changes (see
        ``SessionContext.invalidate_agent``). This avoids re-running the
        factory on every prompt turn.
        """
        if self._static_agent is not None:
            return self._static_agent

        if ctx.cached_agent is not None and ctx.cached_agent_model == ctx.model:
            return ctx.cached_agent

        agent = self._agent_factory(ctx) if callable(self._agent_factory) else self._agent_factory

        ctx.cached_agent = agent
        ctx.cached_agent_model = ctx.model
        return agent

    # ── Streaming ────────────────────────────────────────────────────

    async def _run_streaming(  # noqa: C901
        self,
        agent: Any,
        ctx: SessionContext,
        user_text: str,
        send: Any,
    ) -> None:
        """Run a pydantic-ai-style agent with streaming via ``agent.iter()``."""
        try:
            from pydantic_ai._agent_graph import CallToolsNode, ModelRequestNode
        except ImportError:
            # Fallback: run without internal node types
            result = await agent.run(user_text)
            if result and hasattr(result, "output"):
                await send(update_agent_message(text_block(str(result.output))))
            return

        active_tool_calls: set[str] = set()
        history = ctx.history
        run_result: Any = None

        async with agent.iter(
            user_text,
            message_history=history if history else None,
        ) as run:
            run_result = run
            async for node in run:
                if ctx.cancelled:
                    break

                if isinstance(node, ModelRequestNode):
                    async with node.stream(run.ctx) as request_stream:
                        final_result_found = False

                        async for event in request_stream:
                            if ctx.cancelled:
                                break

                            # Capture tool calls
                            part = getattr(event, "part", None)
                            if (
                                hasattr(part, "tool_name")
                                and hasattr(part, "tool_call_id")
                                and part.tool_call_id not in active_tool_calls
                            ):
                                active_tool_calls.add(part.tool_call_id)
                                kind = self._tool_kind_map.get(part.tool_name, "other")
                                title = part.tool_name
                                if isinstance(getattr(part, "args", None), dict):
                                    args = part.args
                                    if "path" in args:
                                        title = f"{part.tool_name}: {args['path']}"
                                    elif "command" in args:
                                        title = f"{part.tool_name}: {str(args['command'])[:60]}"
                                await send(start_tool_call(
                                    tool_call_id=part.tool_call_id,
                                    title=title,
                                    kind=kind,
                                ))

                            # FinalResultEvent signals text streaming
                            if type(event).__name__ == "FinalResultEvent":
                                final_result_found = True
                                break

                        # Stream final text as deltas
                        if final_result_found:
                            prev_len = 0
                            async for cumulative_text in request_stream.stream_text():
                                if ctx.cancelled:
                                    break
                                delta = cumulative_text[prev_len:]
                                if delta:
                                    await send(update_agent_message_text(delta))
                                prev_len = len(cumulative_text)

                elif isinstance(node, CallToolsNode):
                    async with node.stream(run.ctx) as tool_stream:
                        async for event in tool_stream:
                            if ctx.cancelled:
                                break
                            ename = type(event).__name__
                            if ename == "FunctionToolResultEvent":
                                r = event.result
                                content_str = str(r.content)[:500] if r.content else ""
                                await send(update_tool_call(
                                    tool_call_id=r.tool_call_id,
                                    status="completed",
                                    content=[tool_content(text_block(content_str))]
                                    if content_str else None,
                                ))

        # Save history for next turn (capture before async-with exits)
        if run_result is not None and hasattr(run_result, "result"):
            result = run_result.result
            if result is not None and hasattr(result, "all_messages"):
                try:
                    ctx.history = list(result.all_messages())
                except Exception:
                    logger.debug("Could not capture history for next turn")

    # ── Helpers ──────────────────────────────────────────────────────

    async def _send_text(self, session_id: str, text: str) -> None:
        """Send a text agent message update."""
        await self._conn.session_update(
            session_id=session_id,
            update=update_agent_message(text_block(text)),
            source=self._name,
        )

    def _build_config_options(self, session_id: str) -> list[SessionConfigOptionSelect]:
        """Build config options (model selector) for a session."""
        if not self._models:
            return []

        ctx = self._session_mgr.get(session_id)
        current_model = (ctx.model if ctx else None) or self._models[0]["value"]

        model_options = [
            SessionConfigSelectOption(
                value=m["value"],
                name=m["name"],
                description=m.get("description", ""),
            )
            for m in self._models
        ]
        return [
            SessionConfigOptionSelect(
                id="model",
                name="Model",
                description="Select the AI model",
                category="model",
                type="select",
                current_value=current_model,
                options=model_options,
            )
        ]

    # ── Hooks (override in subclass) ─────────────────────────────────

    def on_session_created(self, ctx: SessionContext) -> None:
        """Called when a new session is created. Override in subclass."""

    def on_session_closed(self, ctx: SessionContext) -> None:
        """Called when a session is closed. Override in subclass."""

    async def run_agent_prompt(
        self,
        ctx: SessionContext,
        prompt: str,
        conn: Client,
    ) -> AsyncIterator[str]:
        """Override to customize agent prompt handling.

        Default behavior uses the agent's ``.iter()`` method for streaming
        or falls back to a simple call.
        """
        return
        yield  # pragma: no cover — make this an async generator
