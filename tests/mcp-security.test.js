import test from "node:test";
import assert from "node:assert/strict";

import {
  MCP_SECURITY_LIMITS,
  getRequiredAccessKey,
  hasValidAccessKey,
  memoryIngestSchema,
  memorySearchSchema,
  memoryWriteSchema
} from "../src/core/mcp-security.js";

test("access key configuration fails closed when missing or blank", () => {
  assert.throws(() => getRequiredAccessKey(new Map()), /MEMORY_MCP_ACCESS_KEY must be configured/);
  assert.throws(
    () => getRequiredAccessKey(new Map([["MEMORY_MCP_ACCESS_KEY", "   "]])),
    /MEMORY_MCP_ACCESS_KEY must be configured/
  );
  assert.equal(getRequiredAccessKey(new Map([["MEMORY_MCP_ACCESS_KEY", "secret-key"]])), "secret-key");
});

test("access key validation rejects blank expected keys and accepts configured headers", () => {
  const headerRequest = new Request("https://example.test", {
    headers: { "x-memory-key": "secret-key" }
  });
  const bearerRequest = new Request("https://example.test", {
    headers: { Authorization: "Bearer secret-key" }
  });

  assert.equal(hasValidAccessKey(headerRequest, ""), false);
  assert.equal(hasValidAccessKey(headerRequest, "secret-key"), true);
  assert.equal(hasValidAccessKey(bearerRequest, "secret-key"), true);
  assert.equal(hasValidAccessKey(bearerRequest, "wrong-key"), false);
});

test("search schema bounds fan-out controls", () => {
  assert.doesNotThrow(() => memorySearchSchema.parse({ query: "memory", k: MCP_SECURITY_LIMITS.MAX_K, expand_depth: MCP_SECURITY_LIMITS.MAX_EXPAND_DEPTH }));
  assert.throws(
    () => memorySearchSchema.parse({ query: "memory", k: MCP_SECURITY_LIMITS.MAX_K + 1 }),
    /too_big/
  );
  assert.throws(
    () => memorySearchSchema.parse({ query: "memory", expand_depth: MCP_SECURITY_LIMITS.MAX_EXPAND_DEPTH + 1 }),
    /too_big/
  );
});

test("write schema bounds content, embeddings, and links", () => {
  assert.throws(
    () =>
      memoryWriteSchema.parse({
        content: "x".repeat(MCP_SECURITY_LIMITS.MAX_CONTENT_LENGTH + 1),
        kind: "memory"
      }),
    /content is too large/
  );

  assert.throws(
    () =>
      memoryWriteSchema.parse({
        content: "safe content",
        kind: "memory",
        embedding: new Array(MCP_SECURITY_LIMITS.MAX_EMBEDDING_DIMENSIONS + 1).fill(0.1)
      }),
    /embedding is too large/
  );

  assert.throws(
    () =>
      memoryWriteSchema.parse({
        content: "safe content",
        kind: "memory",
        links: new Array(MCP_SECURITY_LIMITS.MAX_LINKS + 1).fill({
          to_id: "mem_target",
          edge_type: "related_to"
        })
      }),
    /too many links/
  );
});

test("ingest schema bounds chunk embeddings and chunk sizing", () => {
  assert.throws(
    () =>
      memoryIngestSchema.parse({
        content: "safe content",
        chunk_size: MCP_SECURITY_LIMITS.MAX_CHUNK_SIZE + 1
      }),
    /too_big/
  );

  assert.throws(
    () =>
      memoryIngestSchema.parse({
        content: "safe content",
        chunk_overlap: MCP_SECURITY_LIMITS.MAX_CHUNK_OVERLAP + 1
      }),
    /too_big/
  );

  assert.throws(
    () =>
      memoryIngestSchema.parse({
        content: "safe content",
        chunk_embeddings: new Array(MCP_SECURITY_LIMITS.MAX_CHUNK_EMBEDDINGS + 1).fill([0.1, 0.2])
      }),
    /too many chunk embeddings/
  );
});
