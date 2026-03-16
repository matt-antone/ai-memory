# Adding AI-Memory To An Agent

Use this guide when you want another agent, desktop client, or MCP host to use `ai-memory` as its persistent memory backend.

This guide assumes the backend already exists in this repo and that you want to:

- deploy or reuse the MCP edge endpoint
- register it with an agent host
- give the agent a safe namespace
- establish a simple recall and persistence loop

## What the agent gets

After setup, the agent can call these tools:

- `memory.write`
- `memory.search`
- `memory.get`
- `memory.link`
- `memory.ingest_document`
- `memory.list_recent`
- `memory.promote_summary`

## Tool schema quick reference

- `memory.write.kind` must be one of: `memory`, `document`, `chunk`, `summary`, `fact`.
- Use `fact` for small durable notes such as decisions, preferences, bug fixes, or task outcomes.
- Use `summary` for condensed reusable takeaways.
- Use `document` and `chunk` via `memory.ingest_document`, not direct manual writes.
- Use `memory` as the general-purpose fallback for durable items that are not clearly a `fact` or `summary`.
- Agents should not invent kinds like `note`; unsupported enum values are rejected by schema validation.

In practice, that gives the agent:

- explicit durable memory writes
- lexical or hybrid recall
- namespace-scoped memory separation
- document ingestion with chunking
- graph links between related memories

## Architecture at a glance

The flow is:

1. Your agent host connects to the deployed MCP endpoint.
2. The Supabase edge function validates credentials and request shape.
3. The memory service executes the tool call.
4. Supabase stores items, embeddings, edges, and events.

The endpoint is exposed through:

- `https://<project-ref>.functions.supabase.co/memory-mcp`
- or `https://<project-ref>.supabase.co/functions/v1/memory-mcp`

## Before you start

You need:

- a Supabase project
- the SQL migrations in `supabase/migrations/`
- the deployed edge function in `supabase/functions/memory-mcp`
- one auth strategy:
  - a shared admin key, or
  - scoped client credentials through `MEMORY_MCP_CLIENTS_JSON`

If you have not deployed yet, follow [DEPLOYMENT.md](DEPLOYMENT.md) first.

If you want one guided flow instead of following the individual steps manually, this repo also includes:

```bash
npm run onboard
```

The onboarding CLI walks through project linking, migration push, secret setup, edge-function deploy, install-key registration, and an optional smoke test.

If you later run the uninstall helper, it will detect installed `ai-memory` registrations for Codex, Claude, Cursor, and OpenClaw across project-local and global scopes, then ask which single target you want to remove:

```bash
npm run uninstall
```

`npm run uninstall:local` remains available as a compatibility alias to the same uninstall flow. For each selected target, the helper creates a timestamped backup first when it edits a file-backed config, then removes only the `ai-memory` entry for that chosen install. It still does not remove any Supabase database objects, edge deployments, secrets, or local `.env` files.

## Recommended setup for agents

For real agents, prefer scoped clients over a shared admin key.

Why:

- each install key gets its own secret
- each install key can be locked to a namespace
- server-side namespace enforcement reduces accidental cross-project recall

Example `MEMORY_MCP_CLIENTS_JSON` entry:

```json
[
  {
    "client_id": "codex-desktop",
    "secret": "replace-me",
    "namespace": {
      "scope": "workspace",
      "workspace_id": "/absolute/path/to/project",
      "tags": ["shared"]
    }
  }
]
```

The agent should then send:

- `x-memory-key: <client secret>`
- `x-memory-client-id: <client id>`

## Quickstart: Codex

Add an MCP server entry to `~/.codex/config.toml`:

This repo also includes a helper script:

```bash
npm run setup:codex
```

The script resolves the current install key from `~/.ai-config/ai-memory/config.json`, then prompts for either a project-local install at `.codex/config.toml` or a global install at `~/.codex/config.toml`.
If an `ai-memory` entry already exists, it warns and asks whether to merge or overwrite before changing anything.

```toml
[mcp_servers.ai-memory]
url = "https://<project-ref>.supabase.co/functions/v1/memory-mcp"
bearer_token_env_var = "MEMORY_MCP_ACCESS_KEY"

[mcp_servers.ai-memory.http_headers]
x-memory-key = "MCP_BEARER_TOKEN"
```

If you are using scoped clients instead of a shared key, configure the host to send both:

- `x-memory-key`
- `x-memory-client-id`

Important:

- the credential must exist in the environment visible to the agent host
- if the host is already running, fully restart it after config changes
- the edge function fails closed if credentials are missing or blank

If you use a scoped client, the setup flow writes that client ID into the generated host config for the current install key. Do not set a machine-global `MEMORY_MCP_CLIENT_ID` when multiple installs or repos share the same computer.

## Quickstart: Claude Code

Anthropic's current Claude Code CLI supports adding remote HTTP MCP servers with `claude mcp add --transport http ...`.

This repo also includes a helper script:

```bash
npm run setup:claude
```

The script resolves the current install key from `~/.ai-config/ai-memory/config.json`, then prompts for `project`, `user`, or `local` Claude scope before registering the server.
If an `ai-memory` entry already exists in that scope, it warns before replacing it.

You can override the endpoint or scope when needed:

```bash
MEMORY_MCP_URL="https://<project-ref>.supabase.co/functions/v1/memory-mcp" \
CLAUDE_MCP_SCOPE=user \
npm run setup:claude
```

If you use scoped client auth, set `MEMORY_MCP_CLIENT_ID` before running the script.

If you are using a shared admin key, run:

```bash
claude mcp add --transport http --scope project \
  --header 'x-memory-key: ${MEMORY_MCP_ACCESS_KEY}' \
  ai-memory https://<project-ref>.supabase.co/functions/v1/memory-mcp
```

If you are using a scoped client, run:

```bash
claude mcp add --transport http --scope project \
  --header 'x-memory-key: ${MEMORY_MCP_ACCESS_KEY}' \
  --header 'x-memory-client-id: your-client-id' \
  ai-memory https://<project-ref>.supabase.co/functions/v1/memory-mcp
```

Notes:

- `--scope project` writes the server into `.mcp.json` at the repo root so the project can share the setup
- the single quotes preserve `${...}` so Claude can expand environment variables when it reads `.mcp.json`
- if you want the server available across all repos instead, use `--scope user`
- after adding the server, run `claude mcp list` or `claude mcp get ai-memory` to verify it was registered
- when the script finishes, launch Claude from the repo with:

```bash
cd "/absolute/path/to/project" && set -a && source .env && set +a && claude
```

For this repo, a checked-in `.mcp.json` entry can look like this:

```json
{
  "mcpServers": {
    "ai-memory": {
      "type": "http",
      "url": "https://<project-ref>.supabase.co/functions/v1/memory-mcp",
      "envFile": "${workspaceFolder}/.env",
      "headers": {
        "x-memory-key": "${env:MEMORY_MCP_ACCESS_KEY}"
      }
    }
  }
}
```

And if you are using scoped clients:

```json
{
  "mcpServers": {
    "ai-memory": {
      "type": "http",
      "url": "https://<project-ref>.supabase.co/functions/v1/memory-mcp",
      "envFile": "${workspaceFolder}/.env",
      "headers": {
        "x-memory-key": "${env:MEMORY_MCP_ACCESS_KEY}",
        "x-memory-client-id": "your-client-id"
      }
    }
  }
}
```

## Quickstart: any MCP host

## Quickstart: Cursor

Cursor supports project MCP config through `.cursor/mcp.json`.

This repo includes a helper script:

```bash
npm run setup:cursor
```

The script prompts for either a project-local install at `.cursor/mcp.json` or a global install at `~/.cursor/mcp.json`.
If an `ai-memory` entry already exists, it warns and asks whether to merge or overwrite before changing anything.
If you use scoped client auth, set `MEMORY_MCP_CLIENT_ID` before running the script. The setup helper writes it into the generated MCP config for that install rather than expecting a machine-global env var.
For project-local installs, the generated config points Cursor at `${workspaceFolder}/.env` so repo-scoped secrets are available to MCP header interpolation.
Important: Cursor MCP server keys must use only alphanumeric characters and underscores. Use `ai_memory` (not `ai-memory`) as the key inside `mcpServers`.

Example resulting config:

```json
{
  "mcpServers": {
    "ai_memory": {
      "type": "http",
      "url": "https://<project-ref>.supabase.co/functions/v1/memory-mcp",
      "headers": {
        "x-memory-key": "${MEMORY_MCP_ACCESS_KEY}"
      }
    }
  }
}
```

And with a scoped client:

```json
{
  "mcpServers": {
    "ai_memory": {
      "type": "http",
      "url": "https://<project-ref>.supabase.co/functions/v1/memory-mcp",
      "headers": {
        "x-memory-key": "${MEMORY_MCP_ACCESS_KEY}",
        "x-memory-client-id": "your-client-id"
      }
    }
  }
}
```

After writing the file:

- open Cursor in this repo
- check Settings -> MCP to confirm the server is enabled
- Cursor CLI will also pick up the same MCP project config when run from this workspace

## Quickstart: OpenClaw

This repo now includes an OpenClaw setup helper that writes an `ai_memory` MCP entry into either a project-local or global OpenClaw config.

```bash
npm run setup:openclaw
```

The script prompts for either:

- project-local config at `.openclaw/openclaw.json`
- global config at `~/.openclaw/openclaw.json`

If you choose project-local, OpenClaw must be launched with `OPENCLAW_CONFIG_PATH` pointing at that file so it becomes the active config for the repo.
If an `ai-memory` entry already exists, the script warns and asks whether to merge or overwrite before changing anything.
Use `ai_memory` as the MCP server key for OpenClaw JSON config as well (alphanumeric/underscore only).

## How to scope memory safely

Use namespaces consistently. For most agent integrations, a workspace namespace is the best default.

Example:

```json
{
  "scope": "workspace",
  "workspace_id": "/absolute/path/to/project",
  "topic": "optional-subarea"
}
```

Recommended patterns:

- one workspace namespace per repo or product
- add `topic` when you want durable subdivision inside a workspace
- use tags for looser grouping, not as the primary isolation boundary

If you configure a scoped client with a fixed namespace, the server will enforce that boundary even if the caller sends something broader.

## Recommended memory loop for agents

Agents work best when they do not treat memory as automatic chat history.

Use this loop instead:

### At task start

- call `memory.search` with the current repo, user, or task topic
- include the expected namespace
- if recall is sparse, call `memory.list_recent`
- run a second, more targeted `memory.search` if needed

### During work

- use `memory.write` for stable facts, decisions, fixes, preferences, and reusable notes
- use `memory.link` when relating one memory to another matters later
- use `memory.ingest_document` for long notes, docs, transcripts, or imported artifacts

### At task end

- write a compact durable summary of the outcome
- promote especially reusable material with `memory.promote_summary`

## Suggested instructions to give the agent

You can paste or adapt this into the agent's system prompt or repo instructions:

```md
Use `ai-memory` as the persistent memory system for this project.

At task start:
- Search memory for relevant user, repo, and task context before guessing.
- Use the workspace namespace for this repo.

During the task:
- Persist stable facts, decisions, preferences, and reusable implementation notes with `memory.write`.
- Use `memory.link` for important relationships.
- Use `memory.ingest_document` for long artifacts that should remain searchable.

At task end:
- Store a short reusable summary of the completed work.
```

## Smoke test after registration

Once the agent host is configured, verify this sequence:

1. `initialize`
2. `tools/list`
3. `memory.write` with a small fact
4. `memory.search` for that fact
5. `GET /healthz`
6. `GET /readyz`

If you have local credentials, you can also run:

```bash
MEMORY_MCP_URL="https://<project-ref>.supabase.co/functions/v1/memory-mcp" \
MEMORY_MCP_ACCESS_KEY="..." \
MEMORY_MCP_CLIENT_ID="optional-client-id" \
npm run smoke:mcp
```

## Common failure modes

If the tools do not appear:

- the host likely needs a full restart
- the config may point at the wrong endpoint
- the credential may not be visible in the host environment

If requests fail with auth errors:

- the edge function secret may be missing
- the host may be sending the wrong header
- the scoped client ID and secret may not match the deployed config

If search returns too little:

- check that the agent is using the intended namespace
- verify the agent is actually persisting memories explicitly
- prefer broader natural-language search first, then narrower follow-up queries

## Operational notes

- embeddings are optional and caller-supplied in v1
- lexical search still works without embeddings
- the edge runtime exposes `/healthz` and `/readyz`
- the service validates payloads and enforces request limits before expensive work hits the database

## Related docs

- [README.md](/Users/matthewantone/CurrentDevProjects/AI/ai-memory/README.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [RELEASE.md](RELEASE.md)
- [AGENTS.md](/Users/matthewantone/CurrentDevProjects/AI/ai-memory/AGENTS.md)
