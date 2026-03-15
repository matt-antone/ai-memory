import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { asToolErrorResult, asToolResult } from "../../../src/core/mcp-format.js";
import { loadRuntimePolicy, sanitizeRuntimePolicy, authenticateRequest, enforceNamespace, assertNamespaceAccess, InMemoryRateLimiter, getRequestId, getRequestRateLimitKey } from "../../../src/core/runtime-auth.js";
import { errorPayload, normalizeError, upstreamError, validationError } from "../../../src/core/runtime-errors.js";
import { MemoryService } from "../../../src/core/service.js";
import { SupabaseRestStore } from "../../../src/storage/supabase-rest-store.js";
import {
  memoryGetSchema,
  memoryIngestSchema,
  memoryLinkSchema,
  memoryListRecentSchema,
  memoryPromoteSchema,
  memorySearchSchema,
  memoryWriteSchema
} from "../../../src/core/mcp-security.js";

const runtimePolicy = loadRuntimePolicy(Deno.env);
const rateLimiter = new InMemoryRateLimiter(runtimePolicy.rateLimit);
const preAuthRateLimiter = new InMemoryRateLimiter({
  windowMs: runtimePolicy.rateLimit.windowMs,
  maxRequests: Math.max(runtimePolicy.rateLimit.maxRequests * 3, 300)
});
const store = new SupabaseRestStore({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
});
const MAX_REQUEST_BODY_BYTES = parsePositiveInt(Deno.env.get("MEMORY_MAX_REQUEST_BODY_BYTES"), 256 * 1024);

console.log(JSON.stringify({
  level: "info",
  event: "memory_mcp.startup",
  ...sanitizeRuntimePolicy(runtimePolicy, Deno.env)
}));

function createMemoryServer(requestContext: Record<string, unknown>) {
  const service = new MemoryService(store);
  const server = new McpServer({
    name: "supabase-mcp-memory",
    version: "0.1.0"
  });

  registerTool(server, service, requestContext, "memory.write", {
    title: "Write Memory",
    description: "Persist a durable memory item with optional embedding and links.",
    schema: memoryWriteSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.writeMemory({ ...args, namespace }, context);
  });

  registerTool(server, service, requestContext, "memory.search", {
    title: "Search Memory",
    description: "Search memories using lexical or hybrid ranking with optional graph expansion.",
    schema: memorySearchSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.searchMemory({ ...args, namespace }, context);
  });

  registerTool(server, service, requestContext, "memory.get", {
    title: "Get Memory",
    description: "Fetch one memory item by id.",
    schema: memoryGetSchema
  }, async (args, context) => service.getMemory(args, context));

  registerTool(server, service, requestContext, "memory.link", {
    title: "Link Memory",
    description: "Create a typed relationship between two memory items.",
    schema: memoryLinkSchema
  }, async (args, context) => service.linkMemory(args, context));

  registerTool(server, service, requestContext, "memory.ingest_document", {
    title: "Ingest Document",
    description: "Store a document and deterministic chunks with optional chunk embeddings.",
    schema: memoryIngestSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.ingestDocument({ ...args, namespace }, context);
  });

  registerTool(server, service, requestContext, "memory.list_recent", {
    title: "List Recent Memory",
    description: "List recently created or recalled memory items.",
    schema: memoryListRecentSchema
  }, async (args, context) => {
    const namespace = enforceNamespace(args.namespace, context);
    return service.listRecent({ ...args, namespace }, context);
  });

  registerTool(server, service, requestContext, "memory.promote_summary", {
    title: "Promote Summary",
    description: "Promote a source memory item into a summary item linked back to its origin.",
    schema: memoryPromoteSchema
  }, async (args, context) => {
    if (args.namespace) {
      args = { ...args, namespace: enforceNamespace(args.namespace, context) };
    }
    return service.promoteSummary(args, context);
  });

  return server;
}

function registerTool(server, service, requestContext, name, definition, handler) {
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
        logRequest("info", {
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
        logRequest("error", {
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

Deno.serve(async (request: Request) => {
  const requestId = getRequestId(request);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname.endsWith("/healthz")) {
    return jsonResponse({
      ok: true,
      service: "supabase-mcp-memory",
      version: "0.1.0",
      request_id: requestId
    });
  }

  if (request.method === "GET" && url.pathname.endsWith("/readyz")) {
    try {
      await store.healthCheck();
      return jsonResponse({
        ok: true,
        service: "supabase-mcp-memory",
        version: "0.1.0",
        request_id: requestId
      });
    } catch (error) {
      const normalized = normalizeError(upstreamError("Supabase readiness check failed"), requestId);
      return jsonResponse(errorPayload(normalized), normalized.status);
    }
  }

  try {
    preAuthRateLimiter.consume(getRequestRateLimitKey(request));
    const caller = authenticateRequest(request, runtimePolicy);
    rateLimiter.consume(caller.clientId);
    const requestContext = {
      ...caller,
      assertNamespaceAccess: (namespace) => assertNamespaceAccess(namespace, caller)
    };

    let parsedBody: unknown = undefined;
    try {
      parsedBody = await parseJsonBody(request, requestId);
    } catch (error) {
      if (error instanceof SyntaxError) {
        parsedBody = undefined;
      } else {
        throw error;
      }
      // Leave parsedBody undefined for non-JSON requests.
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true
    });
    const server = createMemoryServer(requestContext);
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody });
  } catch (error) {
    const normalized = normalizeError(error, requestId);
    logRequest("error", {
      event: "memory_mcp.request_error",
      request_id: requestId,
      error_category: normalized.category,
      error_code: normalized.code,
      message: normalized.message
    });
    return jsonResponse(errorPayload(normalized), normalized.status);
  }
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function logRequest(level: string, payload: Record<string, unknown>) {
  console.log(JSON.stringify({
    level,
    ...payload
  }));
}

async function parseJsonBody(request: Request, requestId: string) {
  const contentLength = parsePositiveInt(request.headers.get("content-length"), null);
  if (contentLength !== null && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw validationError("Request body is too large", {
      request_id: requestId,
      max_request_body_bytes: MAX_REQUEST_BODY_BYTES
    });
  }

  const cloned = request.clone();
  const text = await cloned.text();
  if (!text) {
    return undefined;
  }

  if (byteLength(text) > MAX_REQUEST_BODY_BYTES) {
    throw validationError("Request body is too large", {
      request_id: requestId,
      max_request_body_bytes: MAX_REQUEST_BODY_BYTES
    });
  }

  return JSON.parse(text);
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function parsePositiveInt(value: string | null, fallback: number | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
