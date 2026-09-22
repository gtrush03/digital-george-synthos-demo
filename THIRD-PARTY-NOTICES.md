# Source and dependency attribution

- **Strands Agents**: https://github.com/strands-agents/sdk-python — installed as `strands-agents==1.56.0`; Apache-2.0 upstream. This repository contains an original custom model adapter, not a copy of the SDK.
- **Cognee / Cognee MCP**: https://github.com/topoteretes/cognee — Cognee 1.6.0 and cognee-mcp 0.5.5 in the pinned optional environment; retain upstream licenses and service terms.
- **Bright Data CLI / MCP**: https://github.com/brightdata — pinned npm packages 0.3.7 / 2.11.3; their package licenses and service terms apply.
- **Codex**: https://github.com/openai/codex — invoked through the user's official authenticated CLI. No OAuth token or Codex source is distributed here.
- **Jev decision contracts**: four source files from the author's local `trusynth-jev-lab` 0.1.0, question version 2026-09-21.1. Exact file hashes are preserved in `research/jev-decision/core-pin.json`. The imported contract operations are question-building, request/result validation and interpretation. The engine's vendor-provider entry points are not called by this demo. Jev vendor inference is a distinct service; this project does not claim to run its model.
- **Docker validator image**: official Python image pinned by manifest digest in the server; image and bundled components retain their own notices/licenses.

The organizer example that informed framework research was https://github.com/sandhya-subramani/Agent-with-a-Brain at commit `602e537013e947713c3700bce8376066e0a9e3b9`. No vendor clone or example repository is bundled.

First-party source copyright 2026 George Trushevskiy. This public review snapshot does not add a blanket license grant to code with an unspecified license. Public visibility alone does not change third-party rights. Dependencies retain their original licenses. The four local Jev core files arrived without a separate license file; they are published as part of the author's authorized source snapshot, not relabeled as a separately licensed upstream SDK.

Original simple SVG identifiers in this snapshot were created for this public demo. External project videos and historical assets are linked only; their rights are not transferred or asserted.
