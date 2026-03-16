import { createId } from "../utils/id.js";
import { timingSafeCompare } from "../utils/crypto.js";
import { normalizeNamespace } from "./validation.js";
import { authError } from "./runtime-errors.js";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;

export function loadRuntimePolicy(env) {
  const adminSecrets = [];
  const legacySecret = readEnv(env, "MEMORY_MCP_ACCESS_KEY");
  const accessKeys = readEnv(env, "MEMORY_MCP_ACCESS_KEYS");

  if (legacySecret?.trim()) {
    adminSecrets.push(legacySecret.trim());
  }

  if (accessKeys?.trim()) {
    for (const value of accessKeys.split(",")) {
      const trimmed = value.trim();
      if (trimmed && !adminSecrets.includes(trimmed)) {
        adminSecrets.push(trimmed);
      }
    }
  }

  const rawClients = readEnv(env, "MEMORY_MCP_CLIENTS_JSON");
  const clients = new Map();
  if (rawClients?.trim()) {
    const parsed = JSON.parse(rawClients);
    if (!Array.isArray(parsed)) {
      throw new Error("MEMORY_MCP_CLIENTS_JSON must be a JSON array");
    }

    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        throw new Error("MEMORY_MCP_CLIENTS_JSON entries must be objects");
      }
      if (!String(entry.client_id ?? "").trim() || !String(entry.secret ?? "").trim()) {
        throw new Error("MEMORY_MCP_CLIENTS_JSON entries must include client_id and secret");
      }

      clients.set(entry.client_id, {
        clientId: entry.client_id,
        secret: entry.secret,
        role: entry.role === "admin" ? "admin" : "service",
        namespace: normalizeNamespace(entry.namespace ?? {}),
        disabled: entry.disabled === true
      });
    }
  }

  if (adminSecrets.length === 0 && clients.size === 0) {
    throw new Error("At least one admin access key or client credential must be configured");
  }

  return {
    adminSecrets,
    clients,
    rateLimit: {
      windowMs: parsePositiveInt(readEnv(env, "MEMORY_RATE_LIMIT_WINDOW_MS"), DEFAULT_RATE_LIMIT_WINDOW_MS),
      maxRequests: parsePositiveInt(readEnv(env, "MEMORY_RATE_LIMIT_MAX_REQUESTS"), DEFAULT_RATE_LIMIT_MAX_REQUESTS)
    }
  };
}

export function sanitizeRuntimePolicy(policy, env) {
  return {
    service: "supabase-mcp-memory",
    version: "0.1.0",
    project_ref: safeProjectRef(readEnv(env, "SUPABASE_URL")),
    admin_key_count: policy.adminSecrets.length,
    client_count: policy.clients.size,
    rate_limit: policy.rateLimit
  };
}

export function authenticateRequest(request, policy) {
  const requestId = getRequestId(request);
  const providedKey = request.headers.get("x-memory-key")
    ?? parseBearerToken(request.headers.get("authorization") ?? request.headers.get("Authorization"));
  const providedClientId = request.headers.get("x-memory-client-id")?.trim() || null;

  if (!providedKey) {
    throw authError("Missing access key", { request_id: requestId });
  }

  if (providedClientId) {
    const client = policy.clients.get(providedClientId);
    if (!client || client.disabled || !timingSafeCompare(client.secret, providedKey)) {
      throw authError("Invalid client credentials", { request_id: requestId, client_id: providedClientId });
    }
    return {
      requestId,
      clientId: client.clientId,
      role: client.role,
      authMode: "client",
      namespace: client.namespace
    };
  }

  if (policy.adminSecrets.some(s => timingSafeCompare(s, providedKey))) {
    return {
      requestId,
      clientId: "admin",
      role: "admin",
      authMode: "shared-key",
      namespace: null
    };
  }

  if (policy.clients.size === 1) {
    const [client] = policy.clients.values();
    if (!client.disabled && timingSafeCompare(client.secret, providedKey)) {
      return {
        requestId,
        clientId: client.clientId,
        role: client.role,
        authMode: "client",
        namespace: client.namespace
      };
    }
  }

  throw authError("Invalid access key", { request_id: requestId, client_id: providedClientId });
}

export function enforceNamespace(requestedNamespace, caller) {
  const rawRequested = requestedNamespace ?? {};
  const requested = normalizeNamespace(rawRequested);
  if (caller.role === "admin" || !caller.namespace) {
    return requested;
  }

  const allowed = normalizeNamespace(caller.namespace);
  for (const key of ["scope", "workspace_id", "agent_id", "topic"]) {
    const requiredValue = allowed[key];
    if (requiredValue === null || requiredValue === undefined || requiredValue === "") {
      continue;
    }
    const wasExplicitlySet = rawRequested[key] !== null && rawRequested[key] !== undefined && rawRequested[key] !== "";
    if (wasExplicitlySet && requested[key] !== requiredValue) {
      throw authError(`Caller is not allowed to override namespace field: ${key}`, {
        request_id: caller.requestId,
        client_id: caller.clientId
      });
    }
    requested[key] = requiredValue;
  }

  requested.tags = Array.from(new Set([...(allowed.tags ?? []), ...(requested.tags ?? [])]));
  return requested;
}

export function assertNamespaceAccess(itemNamespace, caller) {
  if (caller.role === "admin" || !caller.namespace) {
    return;
  }

  const allowed = normalizeNamespace(caller.namespace);
  const actual = normalizeNamespace(itemNamespace);
  for (const key of ["scope", "workspace_id", "agent_id", "topic"]) {
    const requiredValue = allowed[key];
    if (requiredValue === null || requiredValue === undefined || requiredValue === "") {
      continue;
    }
    if (actual[key] !== requiredValue) {
      throw authError("Caller is not allowed to access this memory item", {
        request_id: caller.requestId,
        client_id: caller.clientId,
        namespace_field: key
      });
    }
  }

  for (const tag of allowed.tags ?? []) {
    if (!(actual.tags ?? []).includes(tag)) {
      throw authError("Caller is not allowed to access this memory item", {
        request_id: caller.requestId,
        client_id: caller.clientId,
        namespace_field: "tags"
      });
    }
  }
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Limitation: state is local to a single Deno isolate and resets on cold start.
 * At higher scale, replace with a distributed store (e.g., Upstash Redis via
 * REST API) keyed by client ID / IP. The interface (consume(key)) is designed
 * to be swappable.
 */
export class InMemoryRateLimiter {
  constructor({ windowMs, maxRequests }) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.entries = new Map();
  }

  consume(key, now = Date.now()) {
    const current = this.entries.get(key) ?? [];
    const cutoff = now - this.windowMs;
    const recent = current.filter((value) => value > cutoff);

    if (recent.length >= this.maxRequests) {
      throw authError("Rate limit exceeded", {
        rate_limit_window_ms: this.windowMs,
        rate_limit_max_requests: this.maxRequests
      });
    }

    recent.push(now);
    this.entries.set(key, recent);
  }
}

export function getRequestId(request) {
  return request.headers.get("x-request-id")
    ?? request.headers.get("x-correlation-id")
    ?? createId("req");
}

export function getRequestRateLimitKey(request) {
  // Prefer platform-set headers (not spoofable by clients).
  const platformIp = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip");
  if (platformIp?.trim()) {
    return `ip:${platformIp.trim()}`;
  }

  // Fall back to x-forwarded-for (first entry, may be spoofed in some configs).
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",", 1);
    if (first?.trim()) {
      return `ip:${first.trim()}`;
    }
  }

  const userAgent = request.headers.get("user-agent")?.trim() || "unknown-agent";
  const origin = request.headers.get("origin")?.trim()
    ?? request.headers.get("referer")?.trim()
    ?? "unknown-origin";
  return `fingerprint:${userAgent}:${origin}`;
}

function parseBearerToken(value) {
  if (!value) {
    return null;
  }
  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnv(env, key) {
  return env?.get?.(key) ?? null;
}

function safeProjectRef(url) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}
