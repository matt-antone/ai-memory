import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createOpenAIEmbedder } from "../core/embedders.js";
import { errorPayload, normalizeError } from "../core/runtime-errors.js";
import {
  authenticateRequest,
  createAuthRequestFromEnv,
  getRequestId,
  loadRuntimePolicy,
  nodeEnvToGetter,
  sanitizeRuntimePolicy
} from "../core/runtime-auth.js";
import { MemoryService } from "../core/service.js";
import { InMemoryStore } from "../storage/in-memory-store.js";
import { SupabaseRestStore } from "../storage/supabase-rest-store.js";
import { registerMemoryMcpTools } from "./memory-mcp-register.js";

function logStderr(payload) {
  console.error(JSON.stringify(payload));
}

function createNodeEmbedder(env) {
  const openAIKey = String(env.OPENAI_API_KEY ?? "").trim();
  if (openAIKey) {
    const model = env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    return createOpenAIEmbedder(openAIKey, model);
  }
  return null;
}

/**
 * Start the memory MCP server on stdio. Intended for `ai-memory mcp` only.
 * Logs diagnostics to stderr; must not write non-MCP JSON to stdout.
 * @param {NodeJS.ProcessEnv} env
 */
export async function runStdioMcp(env) {
  const policyEnv = nodeEnvToGetter(env);
  let runtimePolicy;
  try {
    runtimePolicy = loadRuntimePolicy(policyEnv);
  } catch (error) {
    logStderr({
      level: "error",
      event: "memory_mcp.stdio.config_error",
      message: String(error?.message || error)
    });
    process.exitCode = 1;
    return;
  }

  const authReq = createAuthRequestFromEnv(env);
  let caller;
  try {
    caller = authenticateRequest(authReq, runtimePolicy);
  } catch (error) {
    const normalized = normalizeError(error, getRequestId(authReq));
    logStderr({
      level: "error",
      event: "memory_mcp.stdio.auth_error",
      ...errorPayload(normalized).error
    });
    process.exitCode = 1;
    return;
  }

  let store;
  if (env.AI_MEMORY_MCP_TEST_IN_MEMORY === "1") {
    store = new InMemoryStore();
  } else {
    store = new SupabaseRestStore({
      url: env.SUPABASE_URL ?? "",
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? ""
    });
  }

  const embedder = createNodeEmbedder(env);
  const service = new MemoryService(store, { embedder });
  const requestContext = { ...caller };

  logStderr({
    level: "info",
    event: "memory_mcp.stdio.startup",
    ...sanitizeRuntimePolicy(runtimePolicy, policyEnv)
  });

  const server = new McpServer({
    name: "supabase-mcp-memory",
    version: "0.1.0"
  });

  registerMemoryMcpTools(server, {
    service,
    requestContext,
    log: (level, payload) => logStderr({ level, ...payload })
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
