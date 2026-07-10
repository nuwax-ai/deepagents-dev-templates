#!/usr/bin/env python3
"""flow-debugger event parsing regression tests."""

from __future__ import annotations

import os
import sys
import unittest
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


if __name__ == "__main__":
    unittest.main()
