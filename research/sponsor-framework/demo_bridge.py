"""Runnable bounded bridge proof. This performs a real subscription call if invoked."""
import argparse
import asyncio
import json
from pathlib import Path

from strands import Agent, tool
from strands.hooks import AfterToolCallEvent, HookProvider
from codex_model import CodexSubscriptionModel


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex-home", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--codex-binary", default="codex")
    parser.add_argument("--output-dir", required=True)
    options = parser.parse_args()
    output = Path(options.output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)

    @tool
    def save_brief(text: str) -> str:
        """Save the requested short bridge test to a private, fixed output file."""
        if len(text) > 1000:
            raise ValueError("Bridge proof must be under 1000 characters")
        target = output / "bridge-proof.md"
        target.write_text(text)
        target.chmod(0o600)
        return json.dumps({"saved": str(target), "characters": len(text)})

    class Audit(HookProvider):
        def register_hooks(self, registry):
            registry.add_callback(AfterToolCallEvent, self.after_tool)

        def after_tool(self, event):
            print(json.dumps({"event": "strands_tool_completed", "tool": event.tool_use["name"],
                              "status": event.result.get("status") if event.result else "cancelled"}), flush=True)

    model = CodexSubscriptionModel(codex_home=options.codex_home,
                                  workspace=output / "private-runtime",
                                  model_id=options.model, codex_binary=options.codex_binary,
                                  max_model_calls=3, timeout_seconds=90)
    agent = Agent(model=model, tools=[save_brief], hooks=[Audit()],
                  system_prompt="This is a bridge test, not a sponsor integration proof. Save exactly 'Strands executed a real tool using Codex subscription reasoning.' with save_brief once, then report the result. Do not claim Cognee, Bright Data, or Docker ran.")
    await agent.invoke_async("Run the bounded bridge test.")


if __name__ == "__main__":
    asyncio.run(main())
