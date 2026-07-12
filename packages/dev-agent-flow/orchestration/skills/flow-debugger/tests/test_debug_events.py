#!/usr/bin/env python3
"""flow-debugger event parsing regression tests."""

from __future__ import annotations

import os
import sys
import unittest
import argparse
import io
from unittest import mock


SCRIPT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import debug  # noqa: E402
import debug_http  # noqa: E402


class PermissionEventTests(unittest.TestCase):
    def test_direct_acp_request_permission_payload(self) -> None:
        event = {
            "eventType": "ACP_REQUEST_PERMISSION",
            "data": {
                "toolCall": {"toolCallId": "tool-1"},
                "options": [
                    {"optionId": "allow-1", "kind": "allow_once", "name": "允许一次"},
                    {"optionId": "deny-1", "kind": "reject_once", "name": "拒绝一次"},
                ],
            },
        }

        _, event_data = debug._parse_event_envelope(event)

        self.assertTrue(debug._is_permission_event(event))
        self.assertEqual(debug._extract_tool_id(event_data), "tool-1")
        self.assertEqual(debug._extract_permission_options(event_data)[0]["optionId"], "allow-1")

    def test_nested_request_permission_payload(self) -> None:
        event = {
            "eventType": "PROCESSING",
            "data": {
                "subEventType": "REQUEST_PERMISSION",
                "result": {
                    "input": {
                        "request_permission_request": {
                            "tool_call": {"tool_call_id": "tool-2"},
                            "options": [{"option_id": "allow-2", "kind": "allow_always"}],
                        }
                    }
                },
            },
        }

        _, event_data = debug._parse_event_envelope(event)

        self.assertTrue(debug._is_permission_event(event))
        self.assertEqual(debug._extract_tool_id(event_data), "tool-2")
        self.assertEqual(debug._extract_permission_options(event_data)[0]["option_id"], "allow-2")


class TerminalEventTests(unittest.TestCase):
    def test_completed_true_is_terminal(self) -> None:
        self.assertTrue(debug_http.is_terminal_event({"eventType": "MESSAGE", "completed": True}))

    def test_end_turn_is_terminal(self) -> None:
        self.assertTrue(debug_http.is_terminal_event({"eventType": "PROCESSING", "subType": "end_turn"}))
        self.assertTrue(debug_http.is_terminal_event({"eventType": "PROCESSING", "data": {"sub_type": "end_turn"}}))


class ConversationIdResolveTests(unittest.TestCase):
    def test_explicit_wins(self) -> None:
        with mock.patch.object(debug_http, "fetch_dev_conversation_id", return_value="1555771"):
            self.assertEqual(debug_http.resolve_conversation_id("999"), "999")

    def test_prefers_dev_conversation_id_over_env(self) -> None:
        with mock.patch.dict(os.environ, {"CONVERSATION_ID": "wrong"}, clear=False):
            with mock.patch.object(debug_http, "fetch_dev_conversation_id", return_value="1555771"):
                self.assertEqual(debug_http.resolve_conversation_id(), "1555771")

    def test_falls_back_to_env_when_api_unavailable(self) -> None:
        with mock.patch.dict(os.environ, {"CONVERSATION_ID": "env-id"}, clear=False):
            with mock.patch.object(debug_http, "fetch_dev_conversation_id", return_value=None):
                self.assertEqual(debug_http.resolve_conversation_id(), "env-id")


class DebugConversationSafetyTests(unittest.TestCase):
    def test_default_refuses_executing_conversation(self) -> None:
        args = argparse.Namespace(
            allow_busy=False,
            wait_idle=False,
            after_stop_wait=0,
            wait_idle_timeout=5.0,
            wait_idle_interval=0.1,
        )
        with mock.patch.object(debug, "fetch_conversation_task_status", return_value="EXECUTING"):
            with self.assertRaises(SystemExit) as ctx:
                debug._guard_conversation_before_send(args, "1555771")
        self.assertEqual(ctx.exception.code, 4)

    def test_allow_busy_skips_status_check(self) -> None:
        args = argparse.Namespace(
            allow_busy=True,
            wait_idle=False,
            after_stop_wait=0,
            wait_idle_timeout=5.0,
            wait_idle_interval=0.1,
        )
        with mock.patch.object(debug, "fetch_conversation_task_status") as status:
            debug._guard_conversation_before_send(args, "1555771")
        status.assert_not_called()

    def test_wait_idle_polls_until_terminal(self) -> None:
        args = argparse.Namespace(
            allow_busy=False,
            wait_idle=True,
            after_stop_wait=0,
            wait_idle_timeout=5.0,
            wait_idle_interval=0.1,
        )
        with mock.patch.object(
            debug,
            "fetch_conversation_task_status",
            side_effect=["EXECUTING", "COMPLETE"],
        ):
            with mock.patch("time.sleep"):
                debug._guard_conversation_before_send(args, "1555771")

    def test_create_dev_conversation_returns_id(self) -> None:
        with mock.patch.object(debug_http, "dev_agent_id", return_value=123):
            with mock.patch.object(
                debug_http,
                "api_request",
                return_value=(200, {"code": "0000", "success": True, "data": {"id": 1555999}}),
            ):
                self.assertEqual(debug_http.create_dev_conversation(), "1555999")


class SessionCommandTests(unittest.TestCase):
    def test_cmd_new_creates_conversation(self) -> None:
        import session  # noqa: E402

        with mock.patch.object(session, "create_dev_conversation", return_value="1555999"):
            with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                session.cmd_new(argparse.Namespace(quiet=True))
        self.assertEqual(out.getvalue().strip(), "1555999")

    def test_cmd_new_errors_when_id_missing(self) -> None:
        import session  # noqa: E402

        with mock.patch.object(session, "create_dev_conversation", side_effect=SystemExit(4)):
            with self.assertRaises(SystemExit) as ctx:
                session.cmd_new(argparse.Namespace(quiet=True))
        self.assertEqual(ctx.exception.code, 4)

    def test_cmd_refresh_quiet(self) -> None:
        import session  # noqa: E402

        with mock.patch.object(session, "fetch_dev_conversation_id_strict", return_value="1555999"):
            with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                session.cmd_refresh(argparse.Namespace(quiet=True))
        self.assertEqual(out.getvalue().strip(), "1555999")

    def test_cmd_wait_detects_change(self) -> None:
        import session  # noqa: E402

        with mock.patch.object(
            session,
            "fetch_dev_conversation_id",
            side_effect=["1555771", "1555888"],
        ):
            with mock.patch("time.sleep"):
                with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                    session.cmd_wait(
                        argparse.Namespace(previous="1555771", timeout=5.0, interval=0.1, quiet=False)
                    )
        self.assertIn("1555888", out.getvalue())

    def test_cmd_cancel_prints_next_step_hint(self) -> None:
        import session  # noqa: E402

        with mock.patch.object(session, "resolve_conversation_id", return_value="1555771"):
            with mock.patch.object(
                session,
                "api_request",
                return_value=(200, {"code": "0000", "success": True}),
            ):
                with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
                    session.cmd_cancel(argparse.Namespace(conversation=""))
        self.assertIn("debug.sh --wait-idle", err.getvalue())
        self.assertIn("debug.sh --new-session", err.getvalue())


if __name__ == "__main__":
    unittest.main()
