## 1. Dependencies and entrypoint

- [x] 1.1 Add `@modelcontextprotocol/sdk` (and verify ESM compatibility with `"type": "module"`).
- [x] 1.2 Add a stdio MCP entry script (e.g. `scripts/memory-mcp-stdio.mjs` or `src/mcp/stdio-server.js`) and optional `package.json` `bin` alias (e.g. `ai-memory-mcp`).

## 2. Shared wiring

- [x] 2.1 Extract or duplicate-minimize tool registration so edge and stdio use the same schemas and `MemoryService` handlers (prefer shared module imported by both `supabase/functions/memory-mcp/index.ts` and the Node entrypoint).
- [x] 2.2 Wire `SupabaseRestStore`, embedder creation, and runtime auth policy to match edge behavior for headers/env mapping.

## 3. Stdio server behavior

- [x] 3.1 Instantiate `McpServer`, connect `StdioServerTransport`, and run until stdin closes without unhandled rejections on tool errors.
- [x] 3.2 Map validation/auth failures to MCP tool error results using existing `runtime-errors` / `mcp-format` helpers.

## 4. CLI and Cursor config

- [x] 4.1 Extend `src/utils/agent-config.js` with `upsertJsonServerConfig` support for `type: "stdio"` (command, args, env) alongside existing HTTP upsert.
- [x] 4.2 Update `scripts/ai-memory-cli.mjs` `installJsonHost` for Cursor: default or prompt/env for transport (`stdio` vs `http`); write correct `mcp.json` shape for Cursor.
- [x] 4.3 Update `runDoctor` / status output to detect and report stdio vs HTTP Cursor config.

## 5. Tests

- [x] 5.1 Add tests that spawn the stdio entry with `InMemoryStore` (or test double) via env flag, send one MCP request (or mock transport), and assert a tool round-trip.
- [x] 5.2 Add or update agent-config tests for Cursor stdio JSON shape.

## 6. Documentation

- [x] 6.1 Update README (and CLAUDE.md if needed) with Cursor stdio-first recommendation, env var table, and HTTP vs stdio troubleshooting.
- [x] 6.2 Note migration for existing Cursor users on HTTP (re-run install or manual `mcp.json` edit).
