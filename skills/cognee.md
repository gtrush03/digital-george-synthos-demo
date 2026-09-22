---
id: synthos-plugin-cognee-20260921
type: skill
created: 2026-09-21T23:00:00Z
name: cognee
description: Use Cognee to remember selected project facts and recall them across SYNTHOS tasks through the configured Cognee Cloud account.
triggers: [cognee, remember, recall, persistent memory]
success_count: 0
failure_count: 0
created_by: agent
version: 1.0.0
---

Use the actual Cognee MCP tools available in this session. Read their live schemas before calling them. This plugin uses cognee 1.6.0 and cognee-mcp 0.5.5.

For the Personal Brains demo, store only the facts George selects in dataset `digital_george`. Recall that dataset before generating the next work sample or follow-up. Show which remembered fact affected the result. Scope every operation to this explicitly selected dataset; do not ingest the whole vault or delete unrelated memories.

A successful remember call is not proof that graph processing has finished. Verify with a subsequent recall. Report an authentication or service failure plainly. A local mock or an earlier response is not a new Cognee result.

Use your own Cognee account. Credentials are private machine configuration, outside this vault. Ask for no keys in chat. Have George use the package's `scripts/configure.py` if authentication is missing. Use verified free/event credits for rehearsal.
