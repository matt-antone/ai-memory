const MEMORY_KINDS = new Set(["memory", "document", "chunk", "summary", "fact"]);
const SEARCH_MODES = new Set(["hybrid", "vector", "lexical"]);

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

export function validateWriteInput(input) {
  assertObject(input, "write input");

  if (!String(input.content ?? "").trim()) {
    throw new Error("content is required");
  }

  if (!MEMORY_KINDS.has(input.kind)) {
    throw new Error(`kind must be one of: ${Array.from(MEMORY_KINDS).join(", ")}`);
  }

  if (input.embedding && !Array.isArray(input.embedding)) {
    throw new Error("embedding must be an array when provided");
  }

  if (input.links && !Array.isArray(input.links)) {
    throw new Error("links must be an array when provided");
  }
}

export function validateSearchInput(input) {
  assertObject(input, "search input");

  if (!String(input.query ?? "").trim()) {
    throw new Error("query is required");
  }

  if (input.mode && !SEARCH_MODES.has(input.mode)) {
    throw new Error(`mode must be one of: ${Array.from(SEARCH_MODES).join(", ")}`);
  }

  if (input.query_embedding && !Array.isArray(input.query_embedding)) {
    throw new Error("query_embedding must be an array when provided");
  }
}

export function validateLinkInput(input) {
  assertObject(input, "link input");

  if (!input.from_id || !input.to_id || !input.edge_type) {
    throw new Error("from_id, to_id, and edge_type are required");
  }
}

export function validateIngestInput(input) {
  assertObject(input, "ingest input");

  if (!String(input.content ?? "").trim()) {
    throw new Error("content is required for document ingestion");
  }
}

export function normalizeNamespace(namespace = {}) {
  return {
    scope: namespace.scope ?? "global",
    workspace_id: namespace.workspace_id ?? null,
    agent_id: namespace.agent_id ?? null,
    topic: namespace.topic ?? null,
    tags: Array.isArray(namespace.tags) ? namespace.tags : []
  };
}

export function normalizeSearchMode(mode, hasQueryEmbedding) {
  if (!hasQueryEmbedding) {
    return "lexical";
  }

  if (!mode || mode === "hybrid") {
    return "hybrid";
  }

  return mode;
}
