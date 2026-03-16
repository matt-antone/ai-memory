# Agent-Host-Centric `ai-memory` Refactor

## Summary

Refactor the local `ai-memory` configuration so `~/.ai-config/ai-memory/config.json` is the single source of truth and the first-class managed objects are host agents:

- `claude`
- `codex`
- `cursor`
- `openclaw`

Remove the user-facing `install` concept and remove the separate top-level client registry from the persistent model. Each agent entry owns its auth mode, scoped client id if needed, and namespace list. `currentAgent` remains the machine-default selection used by setup and onboarding.

## Key Changes

### 1. Persistent config model

Replace the current normalized shape with:

```json
{
  "serverName": "ai-memory",
  "url": "https://your-project-ref.supabase.co/functions/v1/memory-mcp",
  "agents": {
    "claude": {
      "authMode": "scoped",
      "clientId": "claude-memory",
      "namespaces": [
        {
          "scope": "workspace",
          "workspace_id": "/Users/matthewantone/CurrentDevProjects/AI/ai-memory",
          "agent_id": null,
          "topic": null,
          "tags": []
        }
      ]
    }
  },
  "currentAgent": "claude",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Normalization rules:

- `agents` is a string-keyed object; keys are agent host ids.
- Each agent record contains:
  - `authMode`: `"scoped"` or `"shared"`
  - `clientId`: required for scoped auth, empty string for shared auth
  - `namespaces`: normalized and deduplicated array
- `currentAgent` must reference an existing agent or normalize to the first available agent or `""`.
- `config.json` stores no secrets.

Migration rules:

- Legacy `clientId` + `installs` configs must migrate into agent entries.
- The intermediate `clients` + `agents` + `currentAgent` shape must also migrate forward.
- Back up legacy config before first rewrite.
- Preserve `serverName`, `url`, timestamps where possible.

Default migration behavior:

- If old install records contain host type info, use host type as the new agent key.
- If migration cannot infer distinct host names, use the existing agent key if present, otherwise fall back to a deterministic host-like name.
- If only one old scoped client exists, map it into the migrated agent’s `clientId`.
- Set `currentAgent` to the first migrated agent if no explicit current value exists.

### 2. Onboarding flow

Rebuild onboarding around agent resolution, not client/install resolution:

1. Resolve Supabase project ref and endpoint.
2. Load centralized config from `~/.ai-config/ai-memory/config.json`.
3. Resolve agent:
   - if no agents exist, create one
   - if agents exist, show list plus `new agent`
   - recommended built-in choices are `claude`, `codex`, `cursor`, `openclaw`
4. Resolve auth for that agent:
   - choose `scoped` or `shared`
   - if `scoped`, collect `clientId`
   - collect secret value
5. Resolve namespace:
   - default namespace is current repo as `scope: "workspace"` and `workspace_id = cwd`
   - if already present on the agent, leave it unchanged
   - otherwise append it
6. Set `currentAgent` to the chosen agent.
7. Persist config.
8. Persist local secret material in `~/.ai-config/ai-memory/env`.
9. Continue with optional Supabase login, link, db push, secrets update, deploy, host setup, and smoke test.

Supabase secret update behavior:

- Shared auth writes `MEMORY_MCP_ACCESS_KEY`.
- Scoped auth rebuilds `MEMORY_MCP_CLIENTS_JSON` from all locally known scoped agents, not just the current one.
- Local secret inventory must be kept in the ai-memory env file so the rebuild uses the full locally known scoped set.
- If any scoped agent in config lacks a local secret, fail before writing Supabase secrets rather than pushing a partial array.

### 3. Setup command behavior

Refactor setup commands around agent hosts:

- `setup:claude` prefers the `claude` agent entry.
- `setup:codex` prefers `codex`.
- `setup:cursor` prefers `cursor`.
- `setup:openclaw` prefers `openclaw`.

Resolution policy:

- If the host-named agent exists, use it directly.
- Otherwise, if `currentAgent` matches the host or only one compatible agent exists, use that.
- Otherwise fail with a clear message telling the user to onboard that host agent.

Generated host config behavior:

- Host files remain adapters only.
- They must derive auth from the chosen agent record:
  - scoped: include `x-memory-client-id`
  - shared: omit `x-memory-client-id`
- They may still prompt for host-local scope like project vs user if that host requires it.
- They must not persist install records or any host-specific durable state in centralized config.

### 4. Secret and local env model

Keep secrets out of `config.json` entirely.

`~/.ai-config/ai-memory/env` should hold:

- `MEMORY_MCP_ACCESS_KEY` for the currently used secret
- `MEMORY_MCP_CLIENT_ID` for the current scoped agent when relevant
- `MEMORY_MCP_AGENT_SECRETS_JSON` or equivalent inventory keyed by agent id or client id

Recommended keying: key by agent id.

Reason:

- user-facing model is agent-centric
- host setup resolves by agent
- avoids confusion when two host agents intentionally use different scoped clients

Each entry in the secret inventory should contain enough to rebuild Supabase scoped clients safely:

- secret
- clientId
- authMode if needed for validation

### 5. Docs and CLI language

Update CLI prompts, README, and setup docs to use agent-host language consistently:

- say “agent” to mean Claude/Codex/Cursor/OpenClaw
- say “scoped client id” only when discussing auth plumbing
- remove “install name” and “named installs”
- describe `currentAgent` as the machine-default host agent
- describe namespaces as belonging to agents

## Public Interfaces / Types

Important interface changes:

- Central config schema changes from:
  - legacy `clientId` / `installs`
  - current intermediate `clients` + `agents`
  to:
  - `agents`
  - `currentAgent`
- Agent record shape becomes:
  - `authMode`
  - `clientId`
  - `namespaces`
- Setup commands conceptually change from “install this host” to “configure this host agent from centralized config”.
- Local env inventory for scoped secrets becomes a required part of safe Supabase secret merging.

## Test Plan

Add or update tests for:

- config normalization of the new agent-host-centric schema
- migration from legacy `clientId` / `installs`
- migration from intermediate `clients` + `agents`
- `currentAgent` normalization and fallback
- onboarding with no config
- onboarding selecting existing agent vs creating new agent
- namespace deduplication per agent
- shared auth agent omits `x-memory-client-id`
- scoped auth agent includes `x-memory-client-id`
- host-specific setup resolves `claude`, `codex`, `cursor`, `openclaw` correctly
- setup fails clearly when the requested host agent is absent
- local secret inventory rebuilds merged `MEMORY_MCP_CLIENTS_JSON` from all locally known scoped agents
- onboarding refuses Supabase secret writes when a scoped agent exists without a local secret
- backward compatibility for existing users and backups on migration

Key scenarios:

- empty config first run
- one `claude` scoped agent
- `claude` + `codex` with different scoped client ids
- `cursor` using shared auth
- switching `currentAgent`
- migrating legacy config
- migrating intermediate config
- multi-agent scoped secret merge

## Assumptions

- Agents are host/application identities, not personas.
- Supported first-class agent ids are `claude`, `codex`, `cursor`, and `openclaw`.
- `clientId` remains an implementation detail for scoped auth, not a top-level managed object.
- Namespaces belong to agents.
- `currentAgent` remains the machine-default selected agent.
- `~/.ai-config/ai-memory/` remains the only durable source of truth.
- Host/project config files remain generated adapters only.
- Safe scoped-client merging is based on locally known secret inventory, not remote Supabase secret readback.
