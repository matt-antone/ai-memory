# Supabase MCP Memory

Provider-agnostic memory and recall system inspired by OpenViking, built around a Supabase backend and an MCP-compatible edge surface.

This repository provides a production-ready memory and recall service for small-team internal use:

- Scoped client authentication with optional shared admin keys
- Server-side namespace enforcement
- Structured runtime errors with stable categories and request IDs
- Health and readiness endpoints
- Transient upstream retry/backoff and lightweight in-memory rate limiting
- Release, smoke-test, and CI conventions

## What is included

This repository includes:

- A provider-agnostic memory core with explicit writes, search, linking, document ingestion, and summary promotion
- An in-memory adapter used for local tests
- A Supabase REST/RPC adapter for real persistence
- A Supabase SQL migration for tables, indexes, and search RPCs
- A Supabase Edge Function that exposes MCP-style tools over JSON-RPC

To use it from an MCP host such as Codex, Claude Desktop, or another compatible agent, you only need to register the deployed endpoint and provide credentials.

## Quickstart

Use this for the fastest path to verify the repo and connect an agent.

1. Install dependencies:

```bash
npm install
```

2. Run the local test suite (no Supabase required):

```bash
npm test
```

3. Run the guided setup for Supabase and agent registration:

```bash
npm run onboard
```

4. Optional (manual alternative to step 3): initialize and install per-agent configuration:

```bash
npm run ai-memory -- init
npm run ai-memory -- install codex
npm run ai-memory -- install claude
npm run ai-memory -- doctor
```

## Repository layout

- `src/core/service.js`: main memory service behavior
- `src/core/chunking.js`: deterministic document chunking
- `src/core/ranking.js`: lexical, vector, recency, and importance scoring helpers
- `src/core/tool-definitions.js`: MCP tool definitions
- `src/storage/in-memory-store.js`: test adapter
- `src/storage/supabase-rest-store.js`: Supabase REST/RPC storage adapter
- `supabase/migrations/`: database migrations (`0001` through `0005`)
- `supabase/baseline/initial_install.sql`: clean schema-only first-install baseline with RLS already enabled
- `supabase/functions/memory-mcp/index.ts`: MCP-compatible edge function
- `tests/`: executable behavior and unit tests (memory service, MCP security, runtime auth, config, and more)

## Implemented MCP tools

- `memory.write`
- `memory.search`
- `memory.get`
- `memory.link`
- `memory.ingest_document`
- `memory.list_recent`
- `memory.promote_summary`

## How the system works

### Memory writes

- Memories are saved explicitly through `memory.write`
- Each item stores content, kind, metadata, namespace, tags, importance, and provenance
- Writes auto-enrich retrieval hints by expanding tags, generating a fallback summary when absent, and storing derived search metadata under `metadata.retrieval`
- Callers may attach embeddings, but embeddings are optional

### Retrieval

- Search supports `lexical`, `vector`, and `hybrid` modes
- If no query embedding is provided, search falls back to lexical mode automatically
- Ranking combines vector similarity, lexical match, recency, and importance
- Lexical search indexes selected metadata keys and values in addition to content, summary, and tags
- Linked context can be expanded on demand through graph edges

### Document ingestion

- `memory.ingest_document` stores a parent document and deterministic chunks
- Chunks can optionally receive caller-supplied embeddings
- Chunk items are linked back to the parent document with `belongs_to`

## Data model

The migration creates these main tables:

- `memory_items`
- `memory_embeddings`
- `memory_edges`
- `memory_namespaces`
- `memory_events`

It also creates:

- Full-text search support with a generated `tsvector`
- Vector search support through `pgvector`
- `memory_search(...)` RPC for ranked retrieval
- `memory_expand_context(...)` RPC for linked-item expansion

## Local development

### Requirements

- Node.js 20+ recommended
- npm
- Supabase CLI for database and edge deployment later

### Install and test

```bash
npm test
```

The test suite uses the in-memory adapter, so it runs without Supabase.

## Agent integration

If you want to attach this memory system to another agent or MCP host, see [docs/ADDING_TO_AN_AGENT.md](docs/ADDING_TO_AN_AGENT.md).

If you want a guided end-to-end setup flow for Supabase plus install-key registration, run `npm run onboard`.
That guide now includes setup for both Codex and Claude Code, including a `claude mcp add --transport http ...` example for remote MCP registration.
For the user-level agent setup flow, run:

```bash
npm run ai-memory -- init
npm run ai-memory -- install codex
npm run ai-memory -- install claude
npm run ai-memory -- doctor
```

That flow stores canonical non-secret config in `~/.ai-config/ai-memory/config.json`, stores the MCP access key in `~/.ai-config/ai-memory/env`, and keeps a centralized install identity there. The selected install key is the write identity used across host setup commands, with optional scoped client ID and namespace list.
The existing `npm run setup:codex` and `npm run setup:claude` commands now act as thin compatibility wrappers over the same agent setup flow.
For Codex and Cursor in this repo, you can also run `npm run setup:codex` and `npm run setup:cursor`.
For OpenClaw in this repo, you can also run `npm run setup:openclaw`.
Each setup command uses the current install key from `~/.ai-config/ai-memory/config.json`, then prompts for project-local or global host scope and warns before updating an existing `ai-memory` registration.
Important for Cursor/OpenClaw JSON MCP configs: `mcpServers` keys must use only letters, numbers, and underscores. Use `ai_memory` (not `ai-memory`) for the server key, or the host may fail to load the MCP definition.
Cursor project installs now write `${env:...}` header references and load `${workspaceFolder}/.env` explicitly, because Cursor does not expand bare `${VAR}` placeholders from repo `.env` files in MCP configs.
Use `npm run uninstall` to detect project-local and global installs across Codex, Cursor, Claude, and OpenClaw, then remove exactly one selected target per run. `npm run uninstall:local` remains as a compatibility alias to the same flow. These commands do not remove the Supabase database, deployed edge function, secrets, or local `.env` files.

## Runtime auth model

The edge function supports two primary credential modes:

- Shared admin key via `MEMORY_MCP_ACCESS_KEY`
- Scoped clients via `MEMORY_MCP_CLIENTS_JSON`

Advanced deployments can also set `MEMORY_MCP_ACCESS_KEYS` as a comma-separated list of admin keys.

Example client configuration:

```json
[
  {
    "client_id": "codex-desktop",
    "secret": "replace-me",
    "namespace": {
      "scope": "workspace",
      "workspace_id": "/Users/matthewantone/CurrentDevProjects/AI/ai-memory",
      "tags": ["shared"]
    }
  }
]
```

Scoped clients should send:

- `x-memory-key: <client secret>`
- `x-memory-client-id: <client id>`

Admin callers may still use `x-memory-key` or `Authorization: Bearer <key>`.

## Supabase setup checklist

When you continue on another machine, these are the next steps:

1. Install the Supabase CLI.
2. Initialize or link a Supabase project.
3. Apply the SQL migrations in `supabase/migrations/` in order.
   For a brand-new project bootstrap outside normal migration history, you can also start from `supabase/baseline/initial_install.sql`, which includes the current schema plus RLS and service-role policies with no seed data.
4. Set edge secrets for:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - One of `MEMORY_MCP_ACCESS_KEY` or `MEMORY_MCP_CLIENTS_JSON`
5. Deploy `supabase/functions/memory-mcp`.
6. Create an access key for the MCP surface and set `MEMORY_MCP_ACCESS_KEY` for your MCP host.
7. Point your MCP client or agent at the deployed edge endpoint.

## Codex setup

The recommended path for Codex and Claude is the user-level installer:

```bash
npm run ai-memory -- init
npm run ai-memory -- install codex
```

That flow writes the Codex MCP entry from `~/.ai-config/ai-memory/config.json` using the current install key and its linked client. Reads remain hive-mind by default.

Codex can connect directly to the deployed Supabase edge function. Add an MCP server entry to `~/.codex/config.toml`:

```toml
[mcp_servers.ai-memory]
url = "https://<project-ref>.functions.supabase.co/memory-mcp"
bearer_token_env_var = "MEMORY_MCP_ACCESS_KEY"

[mcp_servers.ai-memory.http_headers]
x-memory-key = "MCP_BEARER_TOKEN"
```

You can also use the canonical Supabase Functions URL:

```toml
[mcp_servers.ai-memory]
url = "https://<project-ref>.supabase.co/functions/v1/memory-mcp"
bearer_token_env_var = "MEMORY_MCP_ACCESS_KEY"

[mcp_servers.ai-memory.http_headers]
x-memory-key = "MCP_BEARER_TOKEN"
```

Important:

- The `MEMORY_MCP_ACCESS_KEY` value must be present in the environment seen by the Codex desktop app.
- The deployed edge function also requires `MEMORY_MCP_ACCESS_KEY` as a Supabase function secret and will fail closed if it is missing or blank.
- If you add or change the MCP entry while Codex is already running, fully quit and reopen Codex before expecting the `memory.*` tools to appear.
- A quick smoke test is to POST `initialize` and `tools/list` to the endpoint with the `x-memory-key` header.

## Environment variables

The edge function expects:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- One of:
  - `MEMORY_MCP_ACCESS_KEY`
  - `MEMORY_MCP_CLIENTS_JSON`
- Optional:
  - `MEMORY_MCP_ACCESS_KEYS` for multiple admin keys
  - `MEMORY_RATE_LIMIT_WINDOW_MS`
  - `MEMORY_RATE_LIMIT_MAX_REQUESTS`

The edge function rejects oversized or overly expensive MCP requests with schema validation before they hit the database. Current limits cap search fan-out and embedding/document payload sizes.

## Operations

- `GET /healthz` returns a lightweight process health response.
- `GET /readyz` verifies the function can still reach Supabase.
- `npm run smoke:mcp` runs a basic MCP lifecycle smoke test against a deployed edge endpoint.
- `docs/RELEASE.md` describes the release and rollback checklist.

## Documentation

Most repository docs now live in [`docs/`](docs/).

- [`docs/index.md`](docs/index.md): docs landing page for GitHub and GitHub Pages
- [`docs/ADDING_TO_AN_AGENT.md`](docs/ADDING_TO_AN_AGENT.md): agent and host integration guide
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): first deploy checklist
- [`docs/RELEASE.md`](docs/RELEASE.md): release and rollback process

## Notes and constraints

- V1 is provider-agnostic at the storage and contract layer, not at embedding generation time
- Embeddings are caller-supplied when available
- If stored items have no embeddings, they remain searchable lexically
- The current tests verify behavior through the service layer, not against a live Supabase instance
