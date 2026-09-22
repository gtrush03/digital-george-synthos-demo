"""Offline fixture: real Strands loop and filesystem; fake sponsor transports only."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from strands import Agent
from strands.models import Model
from codex_protocol import action_events
from opportunity_room import Run, Trace, build_collaboration_tools, private_write, LAUNCH_TARGETS


class OpportunityRoomBoundaryTest(unittest.IsolatedAsyncioTestCase):
    async def test_pipeline_saves_real_artifacts_with_real_events_and_fixed_network_targets(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent, prefix="fixture-") as directory:
            root = Path(directory)
            credentials = root / "home" / ".config" / "synthos-brains"
            credentials.mkdir(parents=True)
            private_write(credentials / "credentials.json", json.dumps({
                "cogneeUrl": "https://fixture.aws.cognee.ai", "cogneeApiKey": "fixture-only-not-a-credential",
            }))
            requests = []
            commands = []

            class FakeClient:
                def __init__(self, **kwargs):
                    pass

                async def __aenter__(self):
                    return self

                async def __aexit__(self, *args):
                    pass

                async def post(self, url, *, json, headers):
                    requests.append((url, json))
                    class Response:
                        status_code = 200
                        def json(self):
                            return [{"text": "Fixture: selected public writing, reusable proof."}]
                    return Response()

            async def fake_command(arguments, **kwargs):
                commands.append(arguments)
                private_write(Path(arguments[-1]), ("Error\n\n# Sorry, something went wrong.\nhttps://www.facebook.com/" if arguments[2] == LAUNCH_TARGETS["muse"] else "# Fixture page\nExplicitly not a current real opportunity.\n"))
                return b""

            kit = {"selected_target": "own_work", "fit": "fixture only", "gaps": ["real sources not run"],
                   "assets": [{"title": "Fixture asset", "url": "https://github.com/gtrush03/genie"}],
                   "proof_of_work": "Offline fixture", "outreach_status": "SENT"}
            research_actions = [
                ("recall_george_context", {}),
                ("read_public_target", {"target": "muse"}),
                ("read_public_target", {"target": "genie"}),
            ]
            proof_actions = [
                ("select_existing_proof_assets", {"asset_ids": ["genie"], "rationale": "Fixture uses a reviewed public asset.", "project_card_markdown": "# Finished fixture project card\nExisting Genie proof, not a new live result."}),
            ]
            coordinator_actions = [
                ("delegate_research", {}),
                ("delegate_proof", {}),
                ("save_opportunity_room", {"brief_markdown": "# Fixture launch brief", "outreach_markdown": "Fixture unsent intro", "proof_kit_json": json.dumps(kit),
                                          "linkedin_markdown": "Fixture finished LinkedIn post. https://github.com/gtrush03/genie",
                                          "x_thread_markdown": "1/ Fixture finished X post. https://github.com/gtrush03/genie"}),
            ]

            class FixtureModel(Model):
                def __init__(self, actions):
                    self.count = 0
                    self.actions = actions
                def update_config(self, **kwargs):
                    pass
                def get_config(self):
                    return {"model_id": "fixture", "context_window_limit": 10000}
                async def structured_output(self, *args, **kwargs):
                    raise NotImplementedError
                    yield
                async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
                    if self.count < len(self.actions):
                        name, arguments = self.actions[self.count]
                        value = {"kind": "tool", "name": name, "input_json": json.dumps(arguments), "text": ""}
                    else:
                        value = {"kind": "answer", "name": "", "input_json": "", "text": "Fixture complete."}
                    self.count += 1
                    for event in action_events(value, tool_specs):
                        yield event

            run = Run(root / "run", "initial", "Fixture shipped-work launch task", mode="launch")
            models = {}
            def factory(actor):
                scripts = {"Digital George": coordinator_actions, "Research Synth": research_actions, "Proof Synth": proof_actions}
                models[actor] = FixtureModel(scripts[actor])
                return models[actor]
            with patch("opportunity_room.httpx.AsyncClient", FakeClient), patch("opportunity_room.Path.home", return_value=root / "home"), patch("opportunity_room.bounded_process", fake_command):
                agent = Agent(model=factory("Digital George"), tools=build_collaboration_tools(run, "node", factory), hooks=[Trace(run)], callback_handler=None)
                await agent.invoke_async("Run the offline fixture.")
            self.assertTrue(run.memory_ok)
            self.assertEqual(len(requests), 1)
            self.assertTrue(requests[0][1]["onlyContext"])
            self.assertTrue(requests[0][1]["includeReferences"])
            self.assertEqual({command[2] for command in commands}, set(LAUNCH_TARGETS.values()))
            self.assertEqual(len(run.state["artifacts"]), 5)
            saved = json.loads((run.root / "artifacts" / "proof-kit.json").read_text())
            self.assertEqual(saved["outreach_status"], "UNSENT")
            self.assertEqual(saved["source_reads"]["muse"]["status"], "retrieved_error_page")
            self.assertEqual(saved["source_reads"]["genie"]["status"], "retrieved")
            self.assertIn("@GTrushevskiy", requests[0][1]["query"])
            self.assertIn("UNSENT", (run.root / "artifacts" / "outreach-draft.md").read_text())
            self.assertIn("Launch brief", (run.root / "artifacts" / "opportunity-brief.md").read_text())
            self.assertIn("Fixture finished LinkedIn post", (run.root / "artifacts" / "linkedin-post.md").read_text())
            self.assertIn("Fixture finished X post", (run.root / "artifacts" / "x-thread.md").read_text())
            self.assertEqual(saved["mode"], "launch")
            events = [json.loads(line) for line in (run.root / "events.jsonl").read_text().splitlines()]
            self.assertEqual([event["event"] for event in events].count("tool_started"), 7)
            self.assertEqual([event["event"] for event in events].count("tool_completed"), 7)
            self.assertEqual([event["event"] for event in events].count("synth_started"), 2)
            self.assertEqual([event["event"] for event in events].count("synth_completed"), 2)
            self.assertEqual({actor: model.count for actor, model in models.items()}, {"Digital George": 4, "Research Synth": 4, "Proof Synth": 2})
            self.assertEqual({event["actor"] for event in events}, {"Digital George", "Research Synth", "Proof Synth"})
            self.assertTrue(all(event["parent"] == "Digital George" for event in events if event["actor"] != "Digital George"))
            selection = json.loads((run.root / "evidence" / "proof-selection.json").read_text())
            self.assertEqual(selection["actor"], "Proof Synth")
            self.assertEqual(selection["assets"][0]["url"], "https://github.com/gtrush03/genie")
            self.assertEqual(run.state["synths"]["Research Synth"]["status"], "completed")
            self.assertEqual(run.state["synths"]["Proof Synth"]["status"], "completed")
            self.assertNotIn("fixture-only-not-a-credential", (run.root / "events.jsonl").read_text())


if __name__ == "__main__":
    unittest.main()
