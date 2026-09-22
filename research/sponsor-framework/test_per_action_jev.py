"""One fake Codex response, actual pinned Jev helper, no network or model calls."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from codex_model import CodexSubscriptionModel


class SameResponseTest(unittest.IsolatedAsyncioTestCase):
    async def test_shadow_contract_uses_same_response_and_does_not_override_action(self):
        package = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent, prefix="fixture-action-") as directory:
            root = Path(directory)
            model = CodexSubscriptionModel(codex_home=root, workspace=root / "private-runtime" / "fixture-synth", model_id="gpt-5.6-sol")
            calls = []

            async def fake_codex(args, **kwargs):
                calls.append(args[0])
                if args[0] == "login":
                    return b"Logged in using ChatGPT", b""
                schema = json.loads(Path(args[args.index("--output-schema") + 1]).read_text())
                self.assertIn("jev_answers", schema["required"])
                prompt = json.loads(kwargs["input_bytes"])
                self.assertIn("jev_shadow", prompt)
                output = Path(args[args.index("--output-last-message") + 1])
                output.write_text(json.dumps({"kind": "tool", "name": "read_source", "input_json": "{}", "text": "",
                    "jev_answers": {"route": {"type": "choice", "choice": "host_final_answer", "confidence": 0.97,
                        "probabilities": {"read_source": 0.01, "host_final_answer": 0.97, "review": 0.02}}}}))
                return b"", b""

            model._run = fake_codex
            with patch.dict(os.environ, {"JEV_CONTRACTS_ROOT": str(package / "research/jev-decision")}):
                events = [event async for event in model.stream([{"role": "user", "content": [{"text": "Use actual memory and retrieve source."}]}],
                    [{"name": "read_source", "description": "Read configured source", "inputSchema": {"json": {"type": "object", "properties": {}, "additionalProperties": False}}}])]
            self.assertEqual(calls, ["login", "exec"])
            self.assertEqual(events[1]["contentBlockStart"]["start"]["toolUse"]["name"], "read_source")
            receipts = list((root / "jev-decisions").glob("*.json"))
            self.assertEqual(len(receipts), 1)
            receipt = json.loads(receipts[0].read_text())
            self.assertEqual(receipt["mode"], "shadow")
            self.assertEqual(receipt["recommendation"]["handlerId"], "host_final_answer")
            self.assertEqual(receipt["hostSelectedAction"], "read_source")
            self.assertFalse(receipt["genuineJevModelInference"])
            self.assertIsNone(receipt["appliedAction"])


if __name__ == "__main__":
    unittest.main()
