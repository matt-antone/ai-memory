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

- `Session start:` Call `memory.list_recent` twice — once with `namespace: { repo_url: "https://github.com/matt-antone/ai-memory" }` for repo context, and once with no namespace for global context. Global items are included in repo-scoped searches but NOT in repo-scoped `list_recent`.
- `Task start:` If `memory.*` tools are available, call `memory.search` with a query about the user, repo, project, or topic. Review the most relevant hits and use them to ground your work before continuing.
- `Task start:` Start with a repo-scoped query using `namespace: { repo_url: "https://github.com/matt-antone/ai-memory" }` when the task is about this repo. If that returns no hits, follow with `memory.list_recent` in the same namespace and then a second targeted `memory.search`.
- `During task:` When you uncover stable facts, decisions, preferences, patterns, or reusable implementation notes, store them explicitly with `memory.write`.
- `Task end:` After completing a significant task, persist the key outcome, decision, or reusable summary with `memory.write`. When helpful, link related items with `memory.link`.
- `Post-task reflection:` Reflect on what you learned from the task. If there are new patterns, gotchas, architectural decisions, or reusable insights, save them with `memory.write` (skip obvious or already-documented things).
- `Long content:` Use `memory.ingest_document` for meeting notes, transcripts, or external specs that have no home in the repo. Don’t ingest files that already live in the codebase (CLAUDE.md, architecture docs, README, etc.)—they can be read directly and just inflate token usage.
- `Condensing knowledge:` When a stored item should become a durable takeaway, use `memory.promote_summary` to create a higher-value summary linked back to its source.

### Required behavior

- Prefer `memory.search` over guessing when prior project or user context may already exist and the tool is available.
- Read relevant hits instead of relying only on titles or summaries.
- Persist only meaningful, reusable information, not incidental progress chatter.
- Use `namespace: { repo_url: "https://github.com/matt-antone/ai-memory" }` for repo-specific memories. Global memories (no `repo_url`) are automatically included in repo-scoped searches. Do not pass `agent` or `repo_name` — they are set automatically.
- When discussing setup/config in this repo, use **install key** terminology (single identity used across hosts) instead of introducing a separate host-specific agent identity.
- If `ai-memory` is unavailable, say so briefly and continue the main task when possible.

### Suggested patterns

- Use `memory.write` for:
  decisions and their rationale, gotchas hit during development, deployment warnings, things that are NOT already in the code or docs, and completed-task summaries.
- Use `memory.link` for:
  relating a summary to its source, connecting a bug to its fix, or tying a document chunk back to its parent.
- Use `memory.list_recent` for:
  checking recently created or recalled items in the current namespace.
- Recommended recall sequence for this repo:
  1. `memory.search` with `namespace: { repo_url: "https://github.com/matt-antone/ai-memory" }` and a repo/task query
  2. `memory.list_recent` with the same namespace
  3. `memory.search` again with a more targeted query if needed
- Use `memory.get` for:
  retrieving a known item directly by id when a previous step returned it.
