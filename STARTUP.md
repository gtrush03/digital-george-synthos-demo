# Local setup

Use Node 25+ (the Jev helper imports pinned TypeScript source), Python 3.13, `uv`, Docker and the official Codex CLI. No native SYNTHOS binary is bundled.

```sh
npm ci --ignore-scripts
npm run build
npm test
uv venv research/sponsor-framework/.venv --python 3.13
uv pip install --python research/sponsor-framework/.venv/bin/python -r research/sponsor-framework/requirements.lock.txt
```

Configure your own sponsor accounts. The configurator stores Cognee credentials outside the repository with mode 0600 and hides key input. Authenticate the pinned Bright Data CLI with its device-login flow.

```sh
python3 scripts/configure.py
./node_modules/.bin/brightdata login --device
codex login
codex login status
```

The adapter requires `Logged in using ChatGPT`. Supply an existing authenticated Codex home. It does not copy tokens or accept an API-key fallback. Check the CLI's `exec --help`: this snapshot uses `--ignore-user-config`, `--ephemeral`, `--strict-config`, `--output-schema`, and `--output-last-message`; an older CLI may need an update.

In your Cognee tenant, add only selected source-backed facts and writing excerpts to dataset `digital_george`. The private persona used during the live demonstration is excluded. Edit `demo/WORK-EVENT.json` with evidence you can substantiate. The shipped configuration allows only the fixed Meta Muse and public Genie URLs; source changes require a deliberate code change.

For the optional remember/correction tool, install the pinned Cognee MCP environment:

```sh
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.lock
```

Run the dashboard in preview mode:

```sh
node dist/demo-server.js
```

Enable live work with your own configuration:

```sh
export SYNTHOS_CODEX_HOME="$HOME/.codex"
export COGNEE_DATASET_ID='YOUR_OWN_DATASET_ID'
export ROOM_RUN_ENABLED=1
node dist/demo-server.js
```

Open `http://localhost:7999`. The server sets Jev contract/core locations for its workers. It watches `runtime/inbox/` and saves outputs privately below `runtime/`. Optional `ROOM_INBOX`, `SYNTHOS_VAULT`, `ROOM_PYTHON`, `CODEX_BINARY`, and `DOCKER_BINARY` customize local paths. Do not point it at an entire personal archive.

An inbox event is a regular JSON file containing `id`, `project`, `evidence`, `goal`, and optionally `phase` (`initial` or `fresh`). Duplicate IDs/content are not relaunched. Interrupted uncertain launches require review, not automatic retry. The daemon exists only while the server is running.

The Docker validator image is pinned by digest in `src/demo-server.ts`, targeting `linux/arm64`. Pre-pull that image if your demo must start quickly. It checks structure, not truth. All external copy stays in draft.

Offline worker tests:

```sh
cd research/sponsor-framework
.venv/bin/python -m unittest -v test_codex_protocol test_opportunity_room test_per_action_jev
```

No credentials or model calls are needed for those fixtures. The actual-account live path was observed on the original demo machine; the sanitized public setup still requires your account configuration.
