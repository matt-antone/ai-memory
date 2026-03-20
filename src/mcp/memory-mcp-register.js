import { asToolErrorResult, asToolResult } from "../core/mcp-format.js";
import { enforceNamespace } from "../core/runtime-auth.js";
import { errorPayload, normalizeError } from "../core/runtime-errors.js";
import {
  memoryArchiveSchema,
  memoryGetSchema,
  memoryIngestSchema,
  memoryLinkSchema,
  memoryListRecentSchema,
  memoryPromoteSchema,
  memorySearchSchema,
  memoryWriteSchema
} from "../core/mcp-security.js";

/** Register memory MCP tools on an McpServer instance (Node or Deno). */
export function registerMemoryMcpTools(server, { service, requestContext, log = () => {} }) {
  registerOne(server, service, requestContext, log, "memory.write", {
    title: "Write Memory",
    description:
      "Persist a durable memory item with optional embedding and links. kind MUST be one of: memory, document, chunk, summary, fact (do not invent values like note).",
    schema: memoryWriteSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.writeMemory({ ...args, namespace }, context);
  });

  registerOne(server, service, requestContext, log, "memory.search", {
    title: "Search Memory",
    description: "Search memories using lexical or hybrid ranking with optional graph expansion.",
    schema: memorySearchSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.searchMemory({ ...args, namespace }, context);
  });

  registerOne(server, service, requestContext, log, "memory.get", {
    title: "Get Memory",
    description: "Fetch one memory item by id.",
    schema: memoryGetSchema
  }, async (args, context) => service.getMemory(args, context));

  registerOne(server, service, requestContext, log, "memory.link", {
    title: "Link Memory",
    description: "Create a typed relationship between two memory items.",
    schema: memoryLinkSchema
  }, async (args, context) => service.linkMemory(args, context));

  registerOne(server, service, requestContext, log, "memory.ingest_document", {
    title: "Ingest Document",
    description: "Store a document and deterministic chunks with optional chunk embeddings.",
    schema: memoryIngestSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.ingestDocument({ ...args, namespace }, context);
  });

  registerOne(server, service, requestContext, log, "memory.list_recent", {
    title: "List Recent Memory",
    description: "List recently created or recalled memory items.",
    schema: memoryListRecentSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.listRecent({ ...args, namespace }, context);
  });

  registerOne(server, service, requestContext, log, "memory.archive", {
    title: "Archive Memory",
    description: "Archive a memory item so it is excluded from search results.",
    schema: memoryArchiveSchema
  }, async (args, context) => service.archiveMemory(args, context));

  registerOne(server, service, requestContext, log, "memory.promote_summary", {
    title: "Promote Summary",
    description: "Promote a source memory item into a summary item linked back to its origin.",
    schema: memoryPromoteSchema
  }, async (args, context) => {
    let a = args;
    if (a.namespace) {
      a = { ...a, namespace: enforceNamespace(a.namespace, context) };
    }
    return service.promoteSummary(a, context);
  });
}

function registerOne(server, service, requestContext, log, name, definition, handler) {
  server.registerTool(
    name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.schema.shape
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const parsed = definition.schema.parse(args);
        const result = await handler(parsed, requestContext, service);
        log("info", {
          event: "memory_mcp.tool",
          tool: name,
          request_id: requestContext.requestId,
          client_id: requestContext.clientId,
          duration_ms: Date.now() - startedAt,
          result_type: Array.isArray(result) ? "array" : typeof result
        });
        return asToolResult(result);
      } catch (error) {
        const normalized = normalizeError(error, requestContext.requestId);
        log("error", {
          event: "memory_mcp.tool_error",
          tool: name,
          request_id: requestContext.requestId,
          client_id: requestContext.clientId,
          duration_ms: Date.now() - startedAt,
          error_category: normalized.category,
          error_code: normalized.code,
          message: normalized.message
        });
        return asToolErrorResult(errorPayload(normalized).error);
      }
    }
  );
}
