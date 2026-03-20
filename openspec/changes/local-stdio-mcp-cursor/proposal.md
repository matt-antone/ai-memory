## Why

Cursor’s HTTP MCP client path is fragile for remote servers (reconnects, HTTP/2, streaming/SSE through proxies). Users report “connected” UI while tools fail or hang. A **local stdio MCP process** that Cursor spawns avoids that protocol stack while still using Supabase for storage—improving reliability without changing core memory semantics.

Separately, **not every agent session has working MCP**. A **documented CLI fallback** (same `ai-memory` tool users already install) gives every agent a second path without depending on MCP transport.

### Invalid `memory.write.kind` (failed MCP writes)

The server **already defines** allowed values in the MCP tool input schema (`kind` is a closed enum: `memory`, `document`, `chunk`, `summary`, `fact` — see `src/core/mcp-security.js`). Repo rules (`AGENTS.md`, etc.) also say **not** to invent values like `note`. **Despite that**, agents often still send illegal `kind` values, which produces **validation failures** that look like “failed MCP transactions.”

That is usually **models guessing or copying informal labels**, not the absence of a schema: the host **may** expose the enum to the model, but coverage varies (rules not loaded, schema not emphasized in tool descriptions, or the model ignoring constraints). This change should treat that as a **discoverability and ergonomics** problem as well as a transport problem:

- Repeat the **exact allowed `kind` list** in high-traffic agent docs, the ai-memory skill, and CLI fallback examples so every agent sees it even without parsing JSON Schema.
- During implementation, consider **tool description / MCP metadata** tweaks and **validation error payloads** that explicitly list allowed `kind` values (so failures are self-correcting). Optional follow-up: audit `tool-definitions.js` (or equivalent) so descriptions match `AGENTS.md`.

## What Changes

### Stdio MCP (Cursor only, for now)

- Expose stdio MCP through the **existing `ai-memory` CLI** (e.g. a dedicated subcommand such as `ai-memory mcp`) so there is **one** global binary and one install story—not a separate MCP-only executable.
- That subcommand runs **only** the MCP stdio protocol on stdin/stdout (no interactive prompts, no stray stdout logging).
- **Cursor install** (`ai-memory install cursor`) switches to **stdio** config pointing at `ai-memory` + that subcommand (plus env for keys). **Other hosts** (Codex, Claude, OpenClaw) **stay on their current MCP setup** (e.g. HTTP) in this change—no broad migration to stdio yet.

### CLI fallback (all agents)

- Update **agent-facing instructions** (e.g. `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, Codex/OpenClaw memory-loop blocks, and the ai-memory skill) so **every** agent knows: if `memory.*` MCP tools are missing, flaky, or unavailable, use the **`ai-memory` CLI** with explicit, copy-pastable patterns (search/write/etc.) as documented.
- This is **documentation and discoverability only** in scope of this proposal—no requirement to add new CLI subcommands beyond what stdio MCP needs unless the existing CLI surface is insufficient for fallback (then note in design/tasks).

### Unchanged

- **Supabase edge HTTP MCP** remains the remote MCP option for hosts that use URL transport, CI smoke, and non-local agents.
- **No removal** of HTTP MCP or other host installers’ behavior except **Cursor → stdio**.

## Capabilities

### New Capabilities

- `mcp-stdio-local`: Local stdio MCP over the **`ai-memory` CLI**, tool parity with edge MCP, auth/env contract, Cursor `mcp.json` generation for stdio.
- `agent-cli-fallback`: Cross-agent documentation that standardizes **CLI as fallback** when MCP is not usable, and repeats **valid `memory.write.kind`** values wherever write examples appear.

### Modified Capabilities

- _(none — no existing `openspec/specs/` baseline)_

## Impact

- **New module / import path**: stdio MCP wiring (likely under `src/mcp/` or invoked from `scripts/ai-memory-cli.mjs`), plus `@modelcontextprotocol/sdk` in `package.json`.
- **`scripts/ai-memory-cli.mjs`**: new subcommand branch; ensure it never competes with stdin/stdout used by MCP.
- **`src/utils/agent-config.js`**: Cursor stdio shape in `mcp.json` (`command` / `args` / `env`), distinct from HTTP upsert.
- **Docs**: README + agent rule files + skill text for **Cursor stdio**, **global CLI fallback**, and **valid `kind` values** for writes.
- **Optional UX** (implementation detail): clearer tool descriptions and validation errors listing allowed `kind` enums to cut illegal-write noise.
- **Tests**: stdio MCP session smoke; agent-config JSON shape for Cursor.
- **Explicitly out of scope for this proposal**: implementing the above—this document only records the plan; implementation follows `/opsx:apply` and `tasks.md` updates if needed.
