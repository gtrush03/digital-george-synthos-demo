import json
import unittest
from codex_protocol import action_events
from strands import Agent, tool
from strands.models import Model


class ToolBoundaryTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_tool_envelope_and_rejected_unavailable_or_invalid_calls(self):
        specs = [{"name": "save_brief", "inputSchema": {"json": {
            "type": "object", "properties": {"text": {"type": "string"}},
            "required": ["text"], "additionalProperties": False,
        }}}]
        action = {"kind": "tool", "name": "save_brief", "input_json": '{"text":"Evidence first."}', "text": ""}
        events = action_events(action, specs)
        self.assertEqual(events[1]["contentBlockStart"]["start"]["toolUse"]["name"], "save_brief")
        self.assertEqual(json.loads(events[2]["contentBlockDelta"]["delta"]["toolUse"]["input"]), {"text": "Evidence first."})
        self.assertEqual(events[-1], {"messageStop": {"stopReason": "tool_use"}})
        with self.assertRaisesRegex(ValueError, "Unknown or unavailable"):
            action_events({**action, "name": "publish_to_linkedin"}, specs)
        with self.assertRaises(Exception):
            action_events({**action, "input_json": '{"text":7}'}, specs)
        # Exercise the actual pinned Strands agent loop, using fixture model
        # outputs only. This proves the protocol causes a real tool execution.
        calls = []

        @tool
        def save_brief(text: str) -> str:
            """Save a brief into the in-memory fixture."""
            calls.append(text)
            return "saved"

        class FixtureModel(Model):
            count = 0

            def update_config(self, **kwargs):
                pass

            def get_config(self):
                return {"model_id": "fixture", "context_window_limit": 10000}

            async def structured_output(self, *args, **kwargs):
                raise NotImplementedError
                yield

            async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
                self.count += 1
                envelope = action if self.count == 1 else {
                    "kind": "answer", "name": "", "input_json": "", "text": "Done.",
                }
                for event in action_events(envelope, tool_specs or []):
                    yield event

        agent = Agent(model=FixtureModel(), tools=[save_brief], callback_handler=None)
        await agent.invoke_async("Save the fixture brief.")
        self.assertEqual(calls, ["Evidence first."])


if __name__ == "__main__":
    unittest.main()
