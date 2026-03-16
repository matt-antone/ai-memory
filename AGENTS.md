# Agent Instructions

## AI-Memory Loop

Use `ai-memory` as the persistent memory and recall system for work in this repository when `memory.*` tools are available.

### Tool schema quick reference

- `memory.write.kind` must be one of: `memory`, `document`, `chunk`, `summary`, `fact`.
- Use `fact` for a small durable note, decision, preference, workaround, or outcome summary.
- Use `summary` for a condensed reusable takeaway, often after longer work or after promoting a more detailed item.
- Use `document` and `chunk` through `memory.ingest_document` rather than writing them manually.
- Use `memory` as the general-purpose fallback when the item is durable but not best described as a `fact` or `summary`.
- Do not guess enum values such as `note`; the MCP schema rejects unsupported `kind` values.

- `Task start:` If `memory.*` tools are available, call `memory.search` with a query about the user, repo, project, or topic. Review the most relevant hits and use them to ground your work before continuing.
- `Task start:` Start with a workspace-scoped query using `namespace: { scope: "workspace", workspace_id: "/Users/matthewantone/CurrentDevProjects/AI/ai-memory" }` when the task is about this repo. If that returns no hits, follow with `memory.list_recent` in the same namespace and then a second targeted `memory.search` using likely topics or recent decisions.
- `During task:` When you uncover stable facts, decisions, preferences, patterns, or reusable implementation notes, store them explicitly with `memory.write`.
- `Task end:` After completing a significant task, persist the key outcome, decision, or reusable summary with `memory.write`. When helpful, link related items with `memory.link`.
- `Long content:` When you need to store substantial notes, docs, or transcripts, use `memory.ingest_document` so the document is chunked and remains searchable.
- `Condensing knowledge:` When a stored item should become a durable takeaway, use `memory.promote_summary` to create a higher-value summary linked back to its source.

### Required behavior

- Prefer `memory.search` over guessing when prior project or user context may already exist and the tool is available.
- Read relevant hits instead of relying only on titles or summaries.
- Persist only meaningful, reusable information, not incidental progress chatter.
- Use `namespace` consistently when the task is tied to a specific workspace, agent, or topic.
- For this repository, prefer `namespace: { scope: "workspace", workspace_id: "/Users/matthewantone/CurrentDevProjects/AI/ai-memory", topic?: <task-topic> }` for repo-specific memories instead of leaving `workspace_id` null.
- If `ai-memory` is unavailable, say so briefly and continue the main task when possible.

### Suggested patterns

- Use `memory.write` for:
  stable facts, user preferences, architecture decisions, bug workarounds, and completed-task summaries.
- Use `memory.link` for:
  relating a summary to its source, connecting a bug to its fix, or tying a document chunk back to its parent.
- Use `memory.list_recent` for:
  checking recently created or recalled items in the current namespace.
- Recommended recall sequence for this repo:
  1. `memory.search` with the workspace namespace and a repo/task query
  2. `memory.list_recent` with the same workspace namespace
  3. `memory.search` again with the workspace namespace plus a likely `topic`
- Use `memory.get` for:
  retrieving a known item directly by id when a previous step returned it.
