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

- **Namespace scoping**: All operations use `normalizeNamespace()`. Namespace is provenance-only (`repo_url`, `repo_name`, `agent`); no per-client access restrictions. `repo_name` is derived from `repo_url`; `agent` is stamped from auth identity at the edge. Callers supply only `repo_url`.
- **Install identity model**: Setup scripts use one install key as the identity across host registrations; do not assume a separate host-specific agent ID during onboarding/install flows.
- **Embeddings are optional**: Items without embeddings fall back to lexical search automatically.
- **Store adapter contract**: Any new storage backend must implement the adapter interface used by `InMemoryStore` and `SupabaseRestStore`.
- **ESM only**: `"type": "module"` in package.json. All imports use `.js` extensions.
- **Tests use Node's built-in test runner**: `node --test`, not Jest/Mocha. Tests use `describe`/`it`/`assert` from `node:test` and `node:assert`.
- **Edge function imports source directly**: The Deno edge function imports from `../../../src/` (not a bundled package).

## ai-memory workflow

When `memory.*` MCP tools are available, use them as a persistent memory loop for this repo.

**Session start**: Call `memory.list_recent` twice — once with `namespace: { repo_url: "https://github.com/matt-antone/ai-memory" }` for repo context, and once with no namespace for global context. Global items are included in repo-scoped searches but NOT in repo-scoped `list_recent`.

**Task start**: Call `memory.search` with a relevant query and the workspace namespace below. Read the hits — don't guess at prior context.

**During work**: When you uncover stable facts, decisions, preferences, or bug workarounds, persist them with `memory.write`. Skip incidental progress chatter.

**Task end**: Write a concise outcome summary with `memory.write`. Link related items with `memory.link` when the relationship aids future retrieval. Use `memory.promote_summary` to distill a detailed item into a durable takeaway.

**Post-task reflection**: After finishing a task, reflect on what you learned. Capture new patterns, gotchas, architectural decisions, or reusable insights with `memory.write` (skip obvious or already-documented material).

**What to write** — only things that are NOT already in the code or CLAUDE.md:
- Decisions and their rationale ("we chose X because Y was a problem")
- Gotchas hit during development ("X returns 401 if you forget Y header")
- Deployment warnings ("migration Z archives all items — coordinate first")
- Things that didn't work and why
- Cross-session context that would otherwise require re-reading everything

**What NOT to write**:
- Reference docs, architecture summaries, or anything derivable from reading the codebase
- Do NOT use `memory.ingest_document` for CLAUDE.md or similar files — these inflate token costs without adding unique value and will lose to grep on every code question

**Long content**: Use `memory.ingest_document` for meeting notes, transcripts, incident postmortems, or external specs that have no home in the repo. Don’t ingest files that already live in the repository—the CLI can read them directly and ingesting them just inflates token usage.

**Default namespace** for all operations in this repo:
```json
{ "repo_url": "https://github.com/matt-antone/ai-memory" }
```
Global memories (no `repo_url`) are automatically included in repo-scoped searches. `agent` and `repo_name` are set automatically — do not pass them.

**Search tips**:
- Use `mode: "hybrid"` only when you have a `query_embedding`; otherwise omit `mode` or use `"lexical"`.
- Use `expand_depth` only when linked context would actually help.
- If first search returns nothing, follow up with `memory.list_recent` in the same namespace.
- `list_recent` with a repo namespace does NOT return global items — always run a separate `list_recent` with no namespace to surface global context.

**If `memory.*` tools are unavailable**: say so briefly and continue the main task.

## Setup

Run this once to install the memory loop into the global config for Claude Code, Codex, Cursor, and OpenClaw.

The memory loop block to append/create in each target:

```
## ai-memory loop

When `memory.*` MCP tools are available, use them as a persistent memory loop on every task:

- **Session start**: Call `memory.list_recent` twice — once with the repo namespace, once with no namespace. Global items are included in repo-scoped searches but NOT in repo-scoped `list_recent` calls.
- **Task start**: Call `memory.search` with a relevant query to surface prior context before starting work.
- **During work**: Persist stable facts, decisions, discoveries, and bug workarounds with `memory.write`. Skip transient progress chatter.
- **Task end**: Write a concise outcome summary with `memory.write`. Link related items with `memory.link`. Use `memory.promote_summary` to distill detailed items into durable takeaways.
- **Post-task reflection**: After completing a task, reflect on what you learned. If there are new patterns, gotchas, architectural decisions, or reusable insights — save them with `memory.write`. Skip obvious or already-documented things.
- **Long content**: Use `memory.ingest_document` for meeting notes, transcripts, incident postmortems, or external specs that have no home in the repo. Don’t ingest files that already live in the repository—the CLI can read them directly and ingesting them just inflates token usage.

If `memory.*` tools are unavailable, say so briefly and continue the main task.
```

### Targets

1. **Claude Code** — append the block to `~/.claude/CLAUDE.md`

2. **Codex** — append the block to `~/.codex/AGENTS.md`

3. **Cursor** — create `~/.cursor/rules/ai-memory.mdc` with the block as the full file content (create the `~/.cursor/rules/` directory if it doesn't exist)

4. **OpenClaw** — append the block to `~/.openclaw/workspace/AGENTS.md` (create the file and directory if they don't exist)

### How to run

When the user says "run setup" or "install memory loop", execute the four edits above using the available file tools. Confirm which targets were updated and note any that were skipped (e.g. file not found, tool unavailable).

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
