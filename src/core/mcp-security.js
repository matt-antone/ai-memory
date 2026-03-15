import { z } from "zod";

const MAX_CONTENT_LENGTH = 100_000;
const MAX_SUMMARY_LENGTH = 10_000;
const MAX_ID_LENGTH = 256;
const MAX_TYPE_LENGTH = 128;
const MAX_TAGS = 64;
const MAX_TAG_LENGTH = 128;
const MAX_QUERY_LENGTH = 4_000;
const MAX_K = 50;
const MAX_EXPAND_DEPTH = 3;
const MAX_EMBEDDING_DIMENSIONS = 4_096;
const MAX_LINKS = 32;
const MAX_CHUNK_EMBEDDINGS = 256;
const MAX_CHUNK_SIZE = 8_000;
const MAX_CHUNK_OVERLAP = 2_000;

function boundedString(max, field) {
  return z.string().trim().min(1, `${field} is required`).max(max, `${field} is too large`);
}

function optionalBoundedString(max, field) {
  return z.string().trim().max(max, `${field} is too large`).optional();
}

function boundedNumberArray(field) {
  return z
    .array(z.number().finite(), `${field} must be an array of numbers`)
    .min(1, `${field} must not be empty`)
    .max(MAX_EMBEDDING_DIMENSIONS, `${field} is too large`);
}

const boundedTags = z.array(boundedString(MAX_TAG_LENGTH, "tag")).max(MAX_TAGS, "too many tags").optional();
const boundedMetadata = z.record(z.string(), z.unknown()).optional();
const boundedNamespace = z.record(z.string(), z.unknown()).optional();

export const memoryWriteSchema = z.object({
  content: boundedString(MAX_CONTENT_LENGTH, "content"),
  kind: z.enum(["memory", "document", "chunk", "summary", "fact"]),
  summary: optionalBoundedString(MAX_SUMMARY_LENGTH, "summary"),
  embedding: boundedNumberArray("embedding").optional(),
  embedding_model: optionalBoundedString(MAX_TYPE_LENGTH, "embedding_model"),
  source_type: optionalBoundedString(MAX_TYPE_LENGTH, "source_type"),
  source_ref: optionalBoundedString(MAX_ID_LENGTH, "source_ref"),
  metadata: boundedMetadata,
  namespace: boundedNamespace,
  tags: boundedTags,
  importance: z.number().finite().min(0).max(1).optional(),
  links: z
    .array(
      z.object({
        to_id: boundedString(MAX_ID_LENGTH, "to_id"),
        edge_type: boundedString(MAX_TYPE_LENGTH, "edge_type"),
        metadata: boundedMetadata
      })
    )
    .max(MAX_LINKS, "too many links")
    .optional()
});

export const memorySearchSchema = z.object({
  query: boundedString(MAX_QUERY_LENGTH, "query"),
  query_embedding: boundedNumberArray("query_embedding").optional(),
  namespace: boundedNamespace,
  k: z.number().int().min(1).max(MAX_K).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(["hybrid", "vector", "lexical"]).optional(),
  expand_depth: z.number().int().min(0).max(MAX_EXPAND_DEPTH).optional()
});

export const memoryGetSchema = z.object({
  id: boundedString(MAX_ID_LENGTH, "id")
});

export const memoryLinkSchema = z.object({
  from_id: boundedString(MAX_ID_LENGTH, "from_id"),
  to_id: boundedString(MAX_ID_LENGTH, "to_id"),
  edge_type: boundedString(MAX_TYPE_LENGTH, "edge_type"),
  metadata: boundedMetadata
});

export const memoryIngestSchema = z.object({
  content: boundedString(MAX_CONTENT_LENGTH, "content"),
  summary: optionalBoundedString(MAX_SUMMARY_LENGTH, "summary"),
  source_type: optionalBoundedString(MAX_TYPE_LENGTH, "source_type"),
  source_ref: optionalBoundedString(MAX_ID_LENGTH, "source_ref"),
  metadata: boundedMetadata,
  namespace: boundedNamespace,
  tags: boundedTags,
  importance: z.number().finite().min(0).max(1).optional(),
  chunk_embeddings: z.array(boundedNumberArray("chunk_embedding")).max(MAX_CHUNK_EMBEDDINGS, "too many chunk embeddings").optional(),
  chunk_size: z.number().int().min(100).max(MAX_CHUNK_SIZE).optional(),
  chunk_overlap: z.number().int().min(0).max(MAX_CHUNK_OVERLAP).optional()
});

export const memoryListRecentSchema = z.object({
  namespace: boundedNamespace,
  limit: z.number().int().min(1).max(MAX_K).optional()
});

export const memoryPromoteSchema = z.object({
  source_id: boundedString(MAX_ID_LENGTH, "source_id"),
  content: boundedString(MAX_CONTENT_LENGTH, "content"),
  summary: optionalBoundedString(MAX_SUMMARY_LENGTH, "summary"),
  namespace: boundedNamespace,
  importance: z.number().finite().min(0).max(1).optional()
});

export function getRequiredAccessKey(env) {
  const value = env?.get?.("MEMORY_MCP_ACCESS_KEY");
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("MEMORY_MCP_ACCESS_KEY must be configured");
  }
  return value;
}

export function hasValidAccessKey(request, expectedAccessKey) {
  if (typeof expectedAccessKey !== "string" || expectedAccessKey.trim() === "") {
    return false;
  }

  const providedHeader = request.headers.get("x-memory-key");
  if (providedHeader && providedHeader === expectedAccessKey) {
    return true;
  }

  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!authorization) {
    return false;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token === expectedAccessKey;
}

export const MCP_SECURITY_LIMITS = {
  MAX_CONTENT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_ID_LENGTH,
  MAX_TYPE_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_K,
  MAX_EXPAND_DEPTH,
  MAX_EMBEDDING_DIMENSIONS,
  MAX_LINKS,
  MAX_CHUNK_EMBEDDINGS,
  MAX_CHUNK_SIZE,
  MAX_CHUNK_OVERLAP
};
