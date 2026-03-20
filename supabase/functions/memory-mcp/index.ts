import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createOpenAIEmbedder, createSupabaseEmbedder } from "../../../src/core/embedders.js";
import { loadRuntimePolicy, sanitizeRuntimePolicy, authenticateRequest, enforceNamespace, InMemoryRateLimiter, getRequestId, getRequestRateLimitKey } from "../../../src/core/runtime-auth.js";
import { errorPayload, normalizeError, upstreamError, validationError } from "../../../src/core/runtime-errors.js";
import { MemoryService } from "../../../src/core/service.js";
import { SupabaseRestStore } from "../../../src/storage/supabase-rest-store.js";
import { registerMemoryMcpTools } from "../../../src/mcp/memory-mcp-register.js";

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

function createEmbedder() {
  const openAIKey = Deno.env.get("OPENAI_API_KEY");
  if (openAIKey) {
    const model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
    return createOpenAIEmbedder(openAIKey, model);
  }
  const supabaseModel = Deno.env.get("SUPABASE_EMBEDDING_MODEL") ?? "gte-small";
  return createSupabaseEmbedder(supabaseModel);
}

const embedder = createEmbedder();
const MAX_REQUEST_BODY_BYTES = parsePositiveInt(Deno.env.get("MEMORY_MAX_REQUEST_BODY_BYTES"), 256 * 1024);

console.log(JSON.stringify({
  level: "info",
  event: "memory_mcp.startup",
  ...sanitizeRuntimePolicy(runtimePolicy, Deno.env)
}));

function createMemoryServer(requestContext: Record<string, unknown>) {
  const service = new MemoryService(store, { embedder });
  const server = new McpServer({
    name: "supabase-mcp-memory",
    version: "0.1.0"
  });

  registerMemoryMcpTools(server, {
    service,
    requestContext,
    log: (level, payload) => logRequest(level, payload)
  });

  return server;
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
      ...caller
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
    const transportResponse = await transport.handleRequest(request, { parsedBody });
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (key !== "content-type") {
        transportResponse.headers.set(key, value);
      }
    }
    return transportResponse;
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

const SECURITY_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "cache-control": "no-store"
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...SECURITY_HEADERS }
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
