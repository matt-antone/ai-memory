---
name: ai-memory
description: Use ai-memory as the persistent memory and recall system for this repository. Search for relevant user, repo, project, or topic context at task start, read the relevant hits instead of guessing, and persist stable facts, decisions, fixes, and completed-task summaries with `memory.write`, `memory.link`, `memory.ingest_document`, and `memory.promote_summary`. Use when working in this repo, when the user asks to remember or recall something, or when another workflow uncovers reusable knowledge.
---

# AI Memory

Use `ai-memory` as the durable memory layer for this repository when `memory.*` tools are available.

## Purpose

- Ground work in prior repo and user context before making decisions.
- Persist stable knowledge that future sessions should reuse.
- Keep long-form notes searchable through document ingestion and summary promotion.
- Use namespaces consistently so recall stays scoped and relevant.

## Required workflow

### 0. Warm up at session start

When starting a new session (before any specific task):

1. Call `memory.list_recent` with `namespace: { repo_url: "https://github.com/matt-antone/ai-memory" }` to surface repo-specific context.
2. Call `memory.list_recent` with no namespace to surface global context. Global items are included in repo-scoped searches but NOT in repo-scoped `list_recent` — you must call both.
3. Skim the results to orient yourself before diving into the task.

### 1. Ground the task at the start

At the start of a significant task:

1. If `memory.*` tools are available, call `memory.search` with a query about the user, repo, project, feature, bug, or topic.
2. Read the most relevant hit or hits. If the tool returns full items, inspect `hit.item`. If it returns only ids in the current client, call `memory.get`.
3. Use that context before continuing.

Suggested query patterns:

- `"ai-memory repository overview"`
- `"user preferences matthewantone"`
- `"bug workaround supabase memory search"`

### 2. Persist stable discoveries during the task

When you uncover durable information, store it explicitly with `memory.write`.

Good candidates:

- user preferences
- architecture decisions
- bug causes and fixes
- naming conventions
- implementation patterns worth reusing

Do not store incidental progress chatter.

### 3. Persist the outcome at task end

After a significant task:

1. Write a concise completed-task summary with `memory.write`.
2. Link it to supporting items with `memory.link` when relationships matter.
3. If a detailed source item should also have a durable takeaway, use `memory.promote_summary`.

### 4. Post-task reflection

After finishing the task, reflect on what you learned. If there are new patterns, gotchas, architectural decisions, or reusable insights, save them with `memory.write`. Skip anything obvious or already documented in the codebase.

## Namespace defaults

Use a consistent namespace unless the task clearly needs a narrower scope.

Recommended default for this repo:

```json
{ "repo_url": "https://github.com/matt-antone/ai-memory" }
```

Do not pass `agent` or `repo_name` — they are set automatically by the server from auth identity.

Global memories (no `repo_url`) are always included in repo-scoped searches, so user preferences and cross-repo facts are automatically surfaced.

Guidelines:

- Pass `repo_url` for all repo-specific work in this repository.
- Omit `repo_url` only for truly global (cross-repo) user preferences or facts.
- Reuse the same namespace across related writes so `memory.search` and `memory.list_recent` stay coherent.

## Tool guidance

### `memory.search`

Use for task-start grounding and later recall.

- Prefer semantic recall over guessing.
- Pass `namespace` whenever the task is repo-specific.
- Use `mode: "hybrid"` only when you also have `query_embedding`.
- Otherwise omit `mode` or use lexical search.
- Use `expand_depth` only when linked context is useful.

### `memory.write`

Use for durable standalone items.

- Pick the smallest fitting `kind`: `memory`, `fact`, `summary`, `document`, or `chunk`.
- Add `summary`, `tags`, `metadata`, and `importance` when they improve retrieval.
- Keep content self-contained so it still makes sense later.

### `memory.link`

Use to relate items when structure matters.

Useful edge types:

- `derived_from`
- `belongs_to`
- `implements`
- `fixes`
- `related_to`

### `memory.ingest_document`

Use for substantial notes, docs, transcripts, specs, or postmortems.

- Prefer this over many manual `memory.write` calls for long content.
- Include `summary`, `source_ref`, and repo namespace data.
- Search the chunks later with `memory.search`.

### `memory.promote_summary`

Use when a detailed item should yield a shorter durable takeaway.

- Promote high-value source material into a concise summary.
- Keep the promoted summary general enough to be reusable.

### `memory.list_recent`

Use to review recent activity in the current namespace.

- Helpful after a burst of writes or when resuming work.

## Operating rules

- You MUST search before guessing when prior context may exist and `memory.*` tools are available.
- You MUST read relevant hits instead of relying only on titles or summaries.
- You MUST use namespace consistently for repo-tied work.
- For setup/config guidance in this repo, you SHOULD use install-key wording (single identity) instead of introducing separate host-specific agent IDs.
- You MUST say so briefly and continue the main task when `ai-memory` is unavailable.
- You SHOULD write only meaningful, reusable information.
- You SHOULD link related memories when that relationship will help later retrieval.
- You MAY skip persistence for trivial exchanges that add no durable value.

## Minimal execution templates

Session start (warm up) — run both:

```json
{ "tool": "memory.list_recent", "arguments": { "namespace": { "repo_url": "https://github.com/matt-antone/ai-memory" }, "limit": 10 } }
```
```json
{ "tool": "memory.list_recent", "arguments": { "limit": 10 } }
```

Task start:

```json
{
  "tool": "memory.search",
  "arguments": {
    "query": "ai-memory repository overview",
    "namespace": { "repo_url": "https://github.com/matt-antone/ai-memory" }
  }
}
```

Stable fact or decision:

```json
{
  "tool": "memory.write",
  "arguments": {
    "kind": "fact",
    "content": "The ai-memory repo exposes memory.write, memory.search, memory.get, memory.link, memory.ingest_document, memory.list_recent, and memory.promote_summary through the MCP edge function.",
    "summary": "Implemented MCP memory tool surface",
    "namespace": { "repo_url": "https://github.com/matt-antone/ai-memory" },
    "tags": ["tools", "mcp"],
    "importance": 0.8
  }
}
```

Task-end summary:

```json
{
  "tool": "memory.write",
  "arguments": {
    "kind": "summary",
    "content": "Added a repo-local ai-memory skill that requires task-start search, consistent repo_url namespaces, and durable persistence of reusable discoveries and completed-task summaries.",
    "summary": "Created ai-memory repo skill",
    "namespace": { "repo_url": "https://github.com/matt-antone/ai-memory" },
    "tags": ["skill", "memory"],
    "importance": 0.85
  }
}
```

## Failure handling

If `memory.*` tools are unavailable or fail:

1. Report that `ai-memory` was unavailable.
2. State briefly which operation failed.
3. Continue the main task if possible.
4. Do not claim that grounding or persistence happened when it did not.

## Output expectations

When using this skill, report briefly:

- whether context lookup was completed
- whether `ai-memory` writes succeeded
- any namespace choice that matters for later recall
- any remaining memory-system gap
