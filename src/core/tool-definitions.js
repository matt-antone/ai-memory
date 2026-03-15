export const TOOL_DEFINITIONS = [
  {
    name: "memory.write",
    description: "Persist a durable memory item with optional embedding and links.",
    inputSchema: {
      type: "object",
      required: ["content", "kind"],
      properties: {
        content: { type: "string" },
        kind: { type: "string", enum: ["memory", "document", "chunk", "summary", "fact"] },
        summary: { type: "string" },
        embedding: { type: "array", items: { type: "number" } },
        embedding_model: { type: "string" },
        source_type: { type: "string" },
        source_ref: { type: "string" },
        metadata: { type: "object" },
        namespace: { type: "object" },
        tags: { type: "array", items: { type: "string" } },
        importance: { type: "number" },
        links: { type: "array", items: { type: "object" } }
      }
    }
  },
  {
    name: "memory.search",
    description: "Search memories using lexical or hybrid ranking with optional graph expansion.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        query_embedding: { type: "array", items: { type: "number" } },
        namespace: { type: "object" },
        k: { type: "number" },
        filters: { type: "object" },
        mode: { type: "string", enum: ["hybrid", "vector", "lexical"] },
        expand_depth: { type: "number" }
      }
    }
  },
  {
    name: "memory.get",
    description: "Fetch one memory item by id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    }
  },
  {
    name: "memory.link",
    description: "Create a typed relationship between two memory items.",
    inputSchema: {
      type: "object",
      required: ["from_id", "to_id", "edge_type"],
      properties: {
        from_id: { type: "string" },
        to_id: { type: "string" },
        edge_type: { type: "string" },
        metadata: { type: "object" }
      }
    }
  },
  {
    name: "memory.ingest_document",
    description: "Store a document and deterministic chunks with optional chunk embeddings.",
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string" },
        summary: { type: "string" },
        source_type: { type: "string" },
        source_ref: { type: "string" },
        metadata: { type: "object" },
        namespace: { type: "object" },
        tags: { type: "array", items: { type: "string" } },
        importance: { type: "number" },
        chunk_embeddings: { type: "array", items: { type: "array", items: { type: "number" } } },
        chunk_size: { type: "number" },
        chunk_overlap: { type: "number" }
      }
    }
  },
  {
    name: "memory.list_recent",
    description: "List recently created or recalled memory items.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "object" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "memory.promote_summary",
    description: "Promote a source memory item into a summary item linked back to its origin.",
    inputSchema: {
      type: "object",
      required: ["source_id", "content"],
      properties: {
        source_id: { type: "string" },
        content: { type: "string" },
        summary: { type: "string" },
        namespace: { type: "object" },
        importance: { type: "number" }
      }
    }
  }
];
