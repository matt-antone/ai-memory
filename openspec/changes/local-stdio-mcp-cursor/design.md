## Context

Today, **Cursor** is configured via `ai-memory install cursor` to use **HTTP MCP** pointing at the Supabase edge function (`WebStandardStreamableHTTPServerTransport`, `enableJsonResponse: true`). Core logic already lives in **`MemoryService`** and **`SupabaseRestStore`** (shared with the Deno edge entrypoint). Cursor user reports align with **client-side HTTP MCP fragility** (reconnects, streaming, HTTP/2), not necessarily incorrect memory APIs.

## Goals / Non-Goals

**Goals:**

- Provide a **local stdio MCP server** that exposes the **same MCP tools** as the edge function so agents behave consistently.
- Prefer **stdio for Cursor** in install/docs to maximize reliability while keeping **HTTP MCP** for tools that only support URL transport.
- Reuse existing **validation, auth headers, and store** patterns; avoid duplicating business logic.

**Non-Goals:**

- Replacing or removing the edge function as a supported deployment.
- Changing Supabase schema or RPC contracts for this change alone.
- Solving all Cursor IDE bugs; this only removes the remote HTTP MCP hop for users who opt into stdio.

## Decisions

1. **Transport: Node stdio via `@modelcontextprotocol/sdk`**  
   - **Rationale:** Matches MCP’s original deployment model; Cursor spawns one long-lived child process; no SSE/HTTP2 between client and server.  
   - **Alternative:** Keep HTTP only and tune edge headers — leaves Cursor’s HTTP MCP layer in the path.

2. **Reuse `MemoryService` + `SupabaseRestStore` + embedder factories from `src/`**  
   - **Rationale:** Single implementation of write/search/get/link/etc.; edge and stdio differ only in transport wiring.  
   - **Alternative:** Proxy stdio → edge HTTP from Node — doubles latency, keeps failure modes on fetch to edge, still simpler than today but inferior to in-process service.

3. **Credentials: env vars already used for MCP clients** (`MEMORY_MCP_ACCESS_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or documented scoped pattern)  
   - **Rationale:** Stdio cannot hide secrets in the cloud; same trust model as any local CLI. Document clearly.  
   - **Alternative:** Device code / OAuth — out of scope.

4. **Cursor config: `mcp.json` stdio block** with `command` pointing at `node` + path to entry script (or global `ai-memory mcp` subcommand), `env` referencing `${env:VAR}` for Cursor.  
   - **Rationale:** Matches existing `agent-config.js` patterns; user can scope project vs global.  
   - **Alternative:** Only document manual config — worse UX.

5. **Install UX: offer transport choice or default stdio for Cursor**  
   - **Rationale:** Some users may still want HTTP (e.g. uniform with Claude); defaulting stdio maximizes Cursor reliability. Exact default left to implementer; proposal allows “option or default.”

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Service role key on developer machines | Document least-privilege / scoped client credentials where possible; same as any local Supabase tooling. |
| Drift between edge tool list and stdio | Share one registration helper or single module imported by both entrypoints. |
| Extra dependency size (`@modelcontextprotocol/sdk`) | Acceptable for dev dependency or runtime dep used only by stdio binary. |
| Windows path / spawn quirks | Use `node` explicit command and paths documented; test on macOS/Linux first. |

## Migration Plan

1. Ship stdio server + tests.  
2. Update `ai-memory install cursor` to write stdio config (or prompt for transport).  
3. Document migration: users with HTTP config can re-run install or hand-edit `mcp.json`.  
4. Rollback: switch `mcp.json` back to HTTP URL or reinstall previous behavior.

## Open Questions

- **Default for Cursor:** stdio-only vs interactive choice vs env flag (`AI_MEMORY_CURSOR_TRANSPORT`)?  
- **OpenClaw:** adopt same stdio entry for parity or defer?  
- **Embedding in stdio:** match edge env (`OPENAI_API_KEY` / Supabase embedder) — confirm parity in one doc table.
