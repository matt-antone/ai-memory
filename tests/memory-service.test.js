import test from "node:test";
import assert from "node:assert/strict";

import { MemoryService } from "../src/core/service.js";
import { InMemoryStore } from "../src/storage/in-memory-store.js";

function createService() {
  return new MemoryService(new InMemoryStore(), {
    clock: () => new Date("2026-03-14T12:00:00.000Z")
  });
}

test("writes and reads memory items with embeddings", async () => {
  const service = createService();
  const item = await service.writeMemory({
    content: "The project uses Supabase as the memory backend.",
    kind: "fact",
    embedding: [0.9, 0.1],
    embedding_model: "codex-supplied",
    importance: 0.9
  });

  const loaded = await service.getMemory({ id: item.id });
  assert.equal(loaded.kind, "fact");
  assert.equal(loaded.importance, 0.9);
  assert.ok(Array.isArray(loaded.tags));
  assert.ok(loaded.metadata.retrieval);
});

test("archived items are hidden from default search", async () => {
  const store = new InMemoryStore();
  const service = new MemoryService(store, {
    clock: () => new Date("2026-03-14T12:00:00.000Z")
  });

  const item = await service.writeMemory({
    content: "This memory should disappear from search.",
    kind: "memory"
  });

  await store.archiveItem(item.id);
  const results = await service.searchMemory({ query: "disappear", mode: "lexical" });
  assert.equal(results.hits.length, 0);
});

test("lexical-only search works when vectors are absent", async () => {
  const service = createService();
  await service.writeMemory({
    content: "MCP tools can write explicit durable memories.",
    kind: "memory"
  });

  const results = await service.searchMemory({
    query: "durable memories",
    mode: "lexical"
  });

  assert.equal(results.mode_used, "lexical");
  assert.equal(results.hits.length, 1);
});

test("hybrid search boosts vector matches when query embedding is supplied", async () => {
  const service = createService();
  await service.writeMemory({
    content: "Alpha memory about vectors",
    kind: "memory",
    embedding: [1, 0]
  });
  await service.writeMemory({
    content: "Beta memory about vectors",
    kind: "memory",
    embedding: [0, 1]
  });

  const results = await service.searchMemory({
    query: "vectors",
    query_embedding: [0.95, 0.05],
    mode: "hybrid"
  });

  assert.equal(results.hits[0].item.content, "Alpha memory about vectors");
  assert.ok(results.hits[0].breakdown.vector > results.hits[1].breakdown.vector);
});

test("namespace filters isolate recalls", async () => {
  const service = createService();
  await service.writeMemory({
    content: "Workspace A architecture note",
    kind: "memory",
    namespace: { scope: "workspace", workspace_id: "A" }
  });
  await service.writeMemory({
    content: "Workspace B architecture note",
    kind: "memory",
    namespace: { scope: "workspace", workspace_id: "B" }
  });

  const results = await service.searchMemory({
    query: "architecture",
    namespace: { scope: "workspace", workspace_id: "A" },
    mode: "lexical"
  });

  assert.equal(results.hits.length, 1);
  assert.match(results.hits[0].item.content, /Workspace A/);
});

test("graph expansion returns linked context only when requested", async () => {
  const service = createService();
  const source = await service.writeMemory({
    content: "OpenViking-style retrieval pattern",
    kind: "memory"
  });
  const related = await service.writeMemory({
    content: "Supabase edge adapter detail",
    kind: "memory"
  });
  await service.linkMemory({
    from_id: source.id,
    to_id: related.id,
    edge_type: "related_to"
  });

  const withoutExpansion = await service.searchMemory({
    query: "OpenViking",
    mode: "lexical"
  });
  const withExpansion = await service.searchMemory({
    query: "OpenViking",
    mode: "lexical",
    expand_depth: 1
  });

  assert.equal(withoutExpansion.context.length, 0);
  assert.equal(withExpansion.context.length, 1);
  assert.equal(withExpansion.context[0].item.id, related.id);
});

test("document ingestion creates parent document and chunks", async () => {
  const service = createService();
  const content = "First paragraph about memory.\n\nSecond paragraph about retrieval.\n\nThird paragraph about Supabase.";
  const result = await service.ingestDocument({
    content,
    source_type: "note",
    source_ref: "doc://memory-plan",
    chunk_size: 40,
    chunk_overlap: 10
  });

  assert.equal(result.document.kind, "document");
  assert.ok(result.chunks.length >= 2);
  assert.ok(result.chunks.every((chunk) => chunk.kind === "chunk"));
});

test("summary promotion creates a linked durable summary", async () => {
  const service = createService();
  const source = await service.writeMemory({
    content: "The system supports persistent recall with explicit memory writes.",
    kind: "memory",
    importance: 0.4
  });

  const summary = await service.promoteSummary({
    source_id: source.id,
    content: "Persistent recall uses explicit writes.",
    importance: 0.95
  });

  const results = await service.searchMemory({
    query: "persistent recall explicit writes",
    mode: "lexical"
  });

  assert.equal(summary.kind, "summary");
  assert.equal(results.hits[0].item.id, summary.id);
});

test("search falls back to lexical mode when query embeddings are missing", async () => {
  const service = createService();
  await service.writeMemory({
    content: "Lexical fallback keeps memory useful without vectors.",
    kind: "fact"
  });

  const results = await service.searchMemory({
    query: "useful without vectors",
    mode: "hybrid"
  });

  assert.equal(results.mode_used, "lexical");
  assert.equal(results.hits.length, 1);
});

test("writeMemory enriches tags and retrieval metadata for broader recall", async () => {
  const service = createService();
  const item = await service.writeMemory({
    content: "Supabase deployment runbook for MCP memory service",
    kind: "memory",
    metadata: {
      area: "operations",
      owner: "platform-team",
      environment: "staging"
    },
    tags: ["runbook"]
  });

  assert.ok(item.tags.includes("runbook"));
  assert.ok(item.tags.includes("supabase"));
  assert.ok(item.tags.includes("deployment"));
  assert.equal(item.metadata.retrieval.kind, "memory");
  assert.ok(item.metadata.retrieval.search_hints.includes("operations"));
  assert.ok(item.summary.length > 0);
});

test("lexical search can match retrieval metadata terms in the in-memory store", async () => {
  const service = createService();
  await service.writeMemory({
    content: "Operational guide",
    kind: "memory",
    metadata: {
      component: "scheduler",
      owner: "infra-team"
    }
  });

  const results = await service.searchMemory({
    query: "scheduler infra-team",
    mode: "lexical"
  });

  assert.equal(results.hits.length, 1);
  assert.equal(results.hits[0].item.metadata.retrieval.search_hints.includes("scheduler"), true);
});

test("invalid tool payloads are rejected", async () => {
  const service = createService();
  await assert.rejects(
    () => service.writeMemory({ kind: "memory" }),
    /content is required/
  );
});
