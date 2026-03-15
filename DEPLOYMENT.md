# First Deploy Checklist

Use this when you move the project to another machine and connect it to a real Supabase project.

## 1. Install prerequisites

- Install Node.js and npm
- Install the Supabase CLI
- Clone the repository

## 2. Verify the project locally

Run:

```bash
npm test
```

This confirms the core service behavior before any Supabase wiring.

## 3. Connect to Supabase

Either initialize a new project locally or link this repo to an existing Supabase project.

Typical commands:

```bash
supabase login
supabase link
```

If you are starting fresh, initialize Supabase in the repo first.

## 4. Apply the database schema

Apply the migrations in:

- `supabase/migrations/0001_memory.sql`
- `supabase/migrations/0002_search_or_lexical.sql`
- `supabase/migrations/0003_metadata_search_enrichment.sql`
- `supabase/migrations/0004_service_role_policies.sql`
- `supabase/migrations/0005_force_rls_memory_tables.sql`

Depending on your workflow, use either local reset/dev commands or push the migration to the linked project.

For a clean first install on a brand-new project, you can alternatively apply `supabase/baseline/initial_install.sql`. That baseline is schema-only and already enables RLS plus service-role-only policies on the memory tables.

## 5. Configure secrets for the edge function

Set these values for the deployed function:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- One of:
  - `MEMORY_MCP_ACCESS_KEY`
  - `MEMORY_MCP_CLIENTS_JSON`
- Optional:
  - `MEMORY_MCP_ACCESS_KEYS`
  - `MEMORY_RATE_LIMIT_WINDOW_MS`
  - `MEMORY_RATE_LIMIT_MAX_REQUESTS`

## 6. Deploy the MCP edge function

Deploy:

- `supabase/functions/memory-mcp`

After deploy, note the function URL you will use from your MCP client or agent.

Supported URL formats:

- `https://<project-ref>.functions.supabase.co/memory-mcp`
- `https://<project-ref>.supabase.co/functions/v1/memory-mcp`

Configure the access key in your MCP host as `MEMORY_MCP_ACCESS_KEY` and send it as the `x-memory-key` header.
Scoped clients should also send `x-memory-client-id`.
The edge function fails closed if no valid key or client credential is configured.

## 7. Register the MCP server in Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.ai-memory]
url = "https://<project-ref>.functions.supabase.co/memory-mcp"
bearer_token_env_var = "MEMORY_MCP_ACCESS_KEY"

[mcp_servers.ai-memory.http_headers]
x-memory-key = "MCP_BEARER_TOKEN"
```

If the Codex desktop app is already open, fully quit and relaunch it after updating config or environment variables. A running session will not hot-reload newly added MCP servers.

## 8. Smoke test the endpoint

Test these flows first:

- `initialize`
- `tools/list`
- `memory.write`
- `memory.search`
- `memory.ingest_document`
- `GET /healthz`
- `GET /readyz`

If you have the endpoint and credentials locally, you can run:

```bash
MEMORY_MCP_URL="https://<project-ref>.supabase.co/functions/v1/memory-mcp" \
MEMORY_MCP_ACCESS_KEY="..." \
MEMORY_MCP_CLIENT_ID="optional-client-id" \
npm run smoke:mcp
```

## 9. Suggested first real test

1. Write one fact with `memory.write`
2. Search for it with `memory.search`
3. Ingest a short document with `memory.ingest_document`
4. Search for one of its chunks
5. Promote a summary from one stored item

## Current caveats

- Client setup is separate from backend deploy, so a healthy edge function can still be invisible to an MCP host until that host reloads its config and environment
- Live Supabase integration tests are opt-in and require integration environment variables
- Embeddings are optional and caller-supplied in v1

## Promotion and rollback

- Promote changes through local -> staging -> production.
- Block production promotion if `/readyz` or `npm run smoke:mcp` fails in staging.
- Prefer additive database changes and forward fixes after a migration is applied.
- If the edge runtime regresses, redeploy the previous function version and roll back MCP host config to the previous tag.
