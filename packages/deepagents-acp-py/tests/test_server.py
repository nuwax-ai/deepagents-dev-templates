"""Tests for DeepAgentsServer — ACP protocol methods."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from deepagents_acp_py.server import DeepAgentsServer


@pytest.fixture
def mock_agent() -> MagicMock:
    """Create a mock agent (simple callable)."""
    agent = MagicMock()
    agent.return_value = "Hello from agent"
    return agent


@pytest.fixture
def server(mock_agent: MagicMock) -> DeepAgentsServer:
    """Create a DeepAgentsServer with a mock agent."""
    return DeepAgentsServer(
        agent=mock_agent,
        name="test-server",
        version="0.1.0-test",
        models=[
            {"value": "test:model-a", "name": "Model A"},
            {"value": "test:model-b", "name": "Model B"},
        ],
    )


class TestInitialize:
    async def test_initialize_returns_response(self, server: DeepAgentsServer) -> None:
        from acp.schema import ClientCapabilities, Implementation

        resp = await server.initialize(
            protocol_version=1,
            client_capabilities=ClientCapabilities(),
            client_info=Implementation(name="test-client", version="1.0"),
        )
        assert resp.protocolVersion == 1
        assert resp.agentInfo.name == "test-server"
        assert resp.agentInfo.version == "0.1.0-test"


class TestNewSession:
    async def test_new_session_creates_session(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp/project")
        assert resp.sessionId
        assert len(resp.sessionId) == 12
        assert server._session_mgr.has(resp.sessionId)

    async def test_new_session_default_model(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp")
        ctx = server._session_mgr.get(resp.sessionId)
        assert ctx is not None
        assert ctx.model == "test:model-a"
        assert ctx.cwd == "/tmp"

    async def test_new_session_with_mcp(self, server: DeepAgentsServer) -> None:
        mcp_servers = [
            {
                "name": "my-server",
                "command": "npx",
                "args": ["-y", "some-mcp"],
                "env": [{"name": "KEY", "value": "val"}],
            }
        ]
        resp = await server.new_session(cwd="/tmp", mcp_servers=mcp_servers)
        ctx = server._session_mgr.get(resp.sessionId)
        assert ctx is not None
        assert "mcp_servers" in ctx.extra
        assert "my-server" in ctx.extra["mcp_servers"]
        assert ctx.extra["mcp_servers"]["my-server"]["env"] == {"KEY": "val"}

    async def test_new_session_config_options(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp")
        assert len(resp.configOptions) == 1
        assert resp.configOptions[0].id == "model"
        assert len(resp.configOptions[0].options) == 2

    async def test_new_session_no_models(self) -> None:
        srv = DeepAgentsServer(agent=MagicMock())
        resp = await srv.new_session(cwd="/tmp")
        assert len(resp.configOptions) == 0


class TestSessionLifecycle:
    async def test_close_session(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp")
        assert server._session_mgr.has(resp.sessionId)
        await server.close_session(session_id=resp.sessionId)
        assert not server._session_mgr.has(resp.sessionId)

    async def test_list_sessions(self, server: DeepAgentsServer) -> None:
        await server.new_session(cwd="/a")
        await server.new_session(cwd="/b")
        resp = await server.list_sessions()
        assert len(resp["sessions"]) == 2

    async def test_set_session_mode(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp")
        await server.set_session_mode(mode_id="plan", session_id=resp.sessionId)
        ctx = server._session_mgr.get(resp.sessionId)
        assert ctx is not None
        assert ctx.mode == "plan"


class TestModelSwitching:
    async def test_set_session_model(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp")
        await server.set_session_model(model_id="test:model-b", session_id=resp.sessionId)
        ctx = server._session_mgr.get(resp.sessionId)
        assert ctx is not None
        assert ctx.model == "test:model-b"

    async def test_set_config_option_model(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp")
        await server.set_config_option(
            config_id="model",
            session_id=resp.sessionId,
            value="test:model-b",
        )
        ctx = server._session_mgr.get(resp.sessionId)
        assert ctx is not None
        assert ctx.model == "test:model-b"


class TestCancel:
    async def test_cancel_sets_per_session_flag(self, server: DeepAgentsServer) -> None:
        resp = await server.new_session(cwd="/tmp")
        await server.cancel(session_id=resp.sessionId)
        ctx = server._session_mgr.get(resp.sessionId)
        assert ctx is not None
        assert ctx.cancelled is True

    async def test_cancel_does_not_affect_other_sessions(self, server: DeepAgentsServer) -> None:
        resp_a = await server.new_session(cwd="/tmp/a")
        resp_b = await server.new_session(cwd="/tmp/b")
        await server.cancel(session_id=resp_a.sessionId)
        ctx_a = server._session_mgr.get(resp_a.sessionId)
        ctx_b = server._session_mgr.get(resp_b.sessionId)
        assert ctx_a is not None
        assert ctx_b is not None
        assert ctx_a.cancelled is True
        assert ctx_b.cancelled is False


class TestFactoryPattern:
    async def test_factory_called_per_session(self) -> None:
        call_log: list[str] = []

        def build_agent(ctx):
            call_log.append(ctx.session_id)
            return MagicMock()

        srv = DeepAgentsServer(agent=build_agent)
        resp = await srv.new_session(cwd="/tmp")
        # Access agent to trigger factory
        ctx = srv._session_mgr.get(resp.sessionId)
        srv._get_or_create_agent(ctx)
        assert resp.sessionId in call_log

    async def test_factory_cached_across_prompts(self) -> None:
        call_count = 0

        def build_agent(ctx):
            nonlocal call_count
            call_count += 1
            return MagicMock()

        srv = DeepAgentsServer(agent=build_agent)
        resp = await srv.new_session(cwd="/tmp")
        ctx = srv._session_mgr.get(resp.sessionId)
        a1 = srv._get_or_create_agent(ctx)
        a2 = srv._get_or_create_agent(ctx)
        a3 = srv._get_or_create_agent(ctx)
        # Factory called once and result cached on the session
        assert call_count == 1
        assert a1 is a2 is a3

    async def test_factory_rebuilt_on_model_change(self) -> None:
        call_count = 0

        def build_agent(ctx):
            nonlocal call_count
            call_count += 1
            return MagicMock()

        srv = DeepAgentsServer(agent=build_agent)
        resp = await srv.new_session(cwd="/tmp")
        ctx = srv._session_mgr.get(resp.sessionId)
        srv._get_or_create_agent(ctx)
        assert call_count == 1

        # Simulate model switch — should invalidate cache
        await srv.set_session_model(model_id="new-model", session_id=resp.sessionId)
        srv._get_or_create_agent(ctx)
        assert call_count == 2

    async def test_static_agent_reused(self, mock_agent: MagicMock) -> None:
        srv = DeepAgentsServer(agent=mock_agent)
        resp = await srv.new_session(cwd="/tmp")
        ctx = srv._session_mgr.get(resp.sessionId)
        a1 = srv._get_or_create_agent(ctx)
        a2 = srv._get_or_create_agent(ctx)
        assert a1 is a2
