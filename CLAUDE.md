# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A provider-agnostic memory and recall system built on Supabase, exposed as MCP tools over JSON-RPC. Agents (Codex, Claude Desktop, etc.) use it for persistent memory via `memory.write`, `memory.search`, `memory.get`, `memory.link`, `memory.ingest_document`, `memory.list_recent`, and `memory.promote_summary`.

## Commands

```bash
npm test                    # Run all unit tests (in-memory adapter, no Supabase needed)
node --test tests/foo.js    # Run a single test file
npm run test:integration    # Integration tests (requires live Supabase env vars)
npm run smoke:mcp           # MCP lifecycle smoke test against a deployed endpoint
                            # (needs MEMORY_MCP_URL and MEMORY_MCP_ACCESS_KEY)
```

CI runs `npm ci && npm test` on Node 20 (`.github/workflows/ci.yml`).

## Architecture

**Core layer** (`src/core/`):
- `service.js` — `MemoryService` class: all business logic (write, search, get, link, ingest, list_recent, promote_summary). Delegates to a `store` adapter.
- `validation.js` — Input validation and namespace/search-mode normalization.
- `ranking.js` — Scoring: vector similarity, lexical match, recency, importance.
- `chunking.js` — Deterministic text chunking for document ingestion.
- `memory-enrichment.js` — Auto-enriches writes with expanded tags, fallback summaries, and retrieval metadata.
- `mcp-security.js` — Zod schemas for MCP tool input validation (used at the edge).
- `runtime-auth.js` — Auth: shared admin keys, scoped client credentials, namespace enforcement, rate limiting.
- `runtime-errors.js` — Structured error normalization with stable categories and request IDs.
- `tool-definitions.js` — MCP tool definitions (names, descriptions, input shapes).
- `mcp-format.js` — Helpers to format service results as MCP tool responses.

**Utilities** (`src/utils/`):
- `id.js` — ID generation for items, embeddings, edges, and events.
- `prompt.js` — Prompt-building helpers.
- `agent-config.js` — Agent host configuration management.
- `user-config.js` — User-level config persistence (`~/.ai-config/ai-memory/`).
- `crypto.js` — Cryptographic helpers.

**Storage adapters** (`src/storage/`):
- `in-memory-store.js` — In-memory adapter for tests.
- `supabase-rest-store.js` — Supabase REST/RPC adapter for production.

Both implement the same interface: `createItem`, `getItem`, `updateItem`, `archiveItem`, `searchCandidates`, `createEdge`, `expandEdges`, `createEmbedding`, `createEvent`, `listRecent`. `SupabaseRestStore` also exposes `healthCheck` (used by `/readyz`).

**Edge function** (`supabase/functions/memory-mcp/index.ts`):
- Deno-based Supabase Edge Function. Uses `@modelcontextprotocol/sdk` for MCP transport.
- Creates a fresh `McpServer` per request, wires tools to `MemoryService`, handles auth/rate-limiting/error normalization.
- Exposes `/healthz` and `/readyz` health endpoints.

**Database** (`supabase/migrations/`):
- Five migrations: `0001_memory.sql` (core schema + pgvector + full-text search RPCs), `0002_search_or_lexical.sql`, `0003_metadata_search_enrichment.sql`, `0004_service_role_policies.sql`, `0005_force_rls_memory_tables.sql`.
- Key tables: `memory_items`, `memory_embeddings`, `memory_edges`, `memory_namespaces`, `memory_events`.
- Key RPCs: `memory_search(...)`, `memory_expand_context(...)`.

## Key patterns

- **Namespace scoping**: All operations use `normalizeNamespace()`. Scoped clients have server-enforced namespace restrictions.
- **Install identity model**: Setup scripts use one install key as the identity across host registrations; do not assume a separate host-specific agent ID during onboarding/install flows.
- **Embeddings are optional**: Items without embeddings fall back to lexical search automatically.
- **Store adapter contract**: Any new storage backend must implement the adapter interface used by `InMemoryStore` and `SupabaseRestStore`.
- **ESM only**: `"type": "module"` in package.json. All imports use `.js` extensions.
- **Tests use Node's built-in test runner**: `node --test`, not Jest/Mocha. Tests use `describe`/`it`/`assert` from `node:test` and `node:assert`.
- **Edge function imports source directly**: The Deno edge function imports from `../../../src/` (not a bundled package).

## ai-memory workflow

When `memory.*` MCP tools are available, use them as a persistent memory loop for this repo.

**Task start**: Call `memory.search` with a relevant query and the workspace namespace below. Read the hits — don't guess at prior context.

**During work**: When you uncover stable facts, decisions, preferences, or bug workarounds, persist them with `memory.write`. Skip incidental progress chatter.

**Task end**: Write a concise outcome summary with `memory.write`. Link related items with `memory.link` when the relationship aids future retrieval. Use `memory.promote_summary` to distill a detailed item into a durable takeaway.

**Long content**: Use `memory.ingest_document` instead of many individual writes.

**Default namespace** for all operations in this repo:
```json
{
  "scope": "workspace",
  "workspace_id": "/Users/matthewantone/CurrentDevProjects/AI/ai-memory"
}
```
Add `topic` (e.g. `"search"`, `"schema"`, `"auth"`) when the task is focused on one subsystem.

**Search tips**:
- Use `mode: "hybrid"` only when you have a `query_embedding`; otherwise omit `mode` or use `"lexical"`.
- Use `expand_depth` only when linked context would actually help.
- If first search returns nothing, follow up with `memory.list_recent` in the same namespace.

**If `memory.*` tools are unavailable**: say so briefly and continue the main task.
