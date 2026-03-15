import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  getRequiredAccessKey,
  hasValidAccessKey,
  memoryGetSchema,
  memoryIngestSchema,
  memoryLinkSchema,
  memoryListRecentSchema,
  memoryPromoteSchema,
  memorySearchSchema,
  memoryWriteSchema
} from "../../../src/core/mcp-security.js";
import { asToolResult } from "../../../src/core/mcp-format.js";
import { MemoryService } from "../../../src/core/service.js";
import { SupabaseRestStore } from "../../../src/storage/supabase-rest-store.js";

const MEMORY_MCP_ACCESS_KEY = getRequiredAccessKey(Deno.env);

const store = new SupabaseRestStore({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
});

function createMemoryServer() {
  const service = new MemoryService(store);
  const server = new McpServer({
    name: "supabase-mcp-memory",
    version: "0.1.0"
  });

  server.registerTool(
    "memory.write",
    {
      title: "Write Memory",
      description: "Persist a durable memory item with optional embedding and links.",
      inputSchema: memoryWriteSchema.shape
    },
    async (args) => asToolResult(await service.writeMemory(args))
  );

  server.registerTool(
    "memory.search",
    {
      title: "Search Memory",
      description: "Search memories using lexical or hybrid ranking with optional graph expansion.",
      inputSchema: memorySearchSchema.shape
    },
    async (args) => asToolResult(await service.searchMemory(args))
  );

  server.registerTool(
    "memory.get",
    {
      title: "Get Memory",
      description: "Fetch one memory item by id.",
      inputSchema: memoryGetSchema.shape
    },
    async (args) => asToolResult(await service.getMemory(args))
  );

  server.registerTool(
    "memory.link",
    {
      title: "Link Memory",
      description: "Create a typed relationship between two memory items.",
      inputSchema: memoryLinkSchema.shape
    },
    async (args) => asToolResult(await service.linkMemory(args))
  );

  server.registerTool(
    "memory.ingest_document",
    {
      title: "Ingest Document",
      description: "Store a document and deterministic chunks with optional chunk embeddings.",
      inputSchema: memoryIngestSchema.shape
    },
    async (args) => asToolResult(await service.ingestDocument(args))
  );

  server.registerTool(
    "memory.list_recent",
    {
      title: "List Recent Memory",
      description: "List recently created or recalled memory items.",
      inputSchema: memoryListRecentSchema.shape
    },
    async (args) => asToolResult(await service.listRecent(args))
  );

  server.registerTool(
    "memory.promote_summary",
    {
      title: "Promote Summary",
      description: "Promote a source memory item into a summary item linked back to its origin.",
      inputSchema: memoryPromoteSchema.shape
    },
    async (args) => asToolResult(await service.promoteSummary(args))
  );

  return server;
}

Deno.serve(async (request: Request) => {
  if (!hasValidAccessKey(request, MEMORY_MCP_ACCESS_KEY)) {
    return new Response(JSON.stringify({ error: "Invalid or missing access key" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }

  let parsedBody: unknown = undefined;
  try {
    parsedBody = await request.clone().json();
  } catch {
    // Leave parsedBody undefined for non-JSON requests.
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true
  });
  const server = createMemoryServer();
  await server.connect(transport);
  return await transport.handleRequest(request, { parsedBody });
});
