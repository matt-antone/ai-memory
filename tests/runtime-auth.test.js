import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryRateLimiter,
  assertNamespaceAccess,
  authenticateRequest,
  enforceNamespace,
  getRequestRateLimitKey,
  loadRuntimePolicy
} from "../src/core/runtime-auth.js";

test("runtime policy loads admin keys and scoped clients", () => {
  const policy = loadRuntimePolicy(new Map([
    ["MEMORY_MCP_ACCESS_KEY", "admin-secret"],
    ["MEMORY_MCP_CLIENTS_JSON", JSON.stringify([
      {
        client_id: "client-a",
        secret: "client-secret",
        namespace: { scope: "workspace", workspace_id: "repo-a", tags: ["shared"] }
      }
    ])]
  ]));

  assert.equal(policy.adminSecrets.has("admin-secret"), true);
  assert.equal(policy.clients.get("client-a").namespace.workspace_id, "repo-a");
});

test("authenticateRequest accepts scoped clients and shared admin keys", () => {
  const policy = loadRuntimePolicy(new Map([
    ["MEMORY_MCP_ACCESS_KEY", "admin-secret"],
    ["MEMORY_MCP_CLIENTS_JSON", JSON.stringify([
      {
        client_id: "client-a",
        secret: "client-secret",
        namespace: { scope: "workspace", workspace_id: "repo-a" }
      }
    ])]
  ]));

  const clientRequest = new Request("https://example.test", {
    headers: {
      "x-memory-key": "client-secret",
      "x-memory-client-id": "client-a",
      "x-request-id": "req-1"
    }
  });
  const adminRequest = new Request("https://example.test", {
    headers: {
      Authorization: "Bearer admin-secret"
    }
  });

  const client = authenticateRequest(clientRequest, policy);
  const admin = authenticateRequest(adminRequest, policy);

  assert.equal(client.clientId, "client-a");
  assert.equal(client.namespace.workspace_id, "repo-a");
  assert.equal(admin.role, "admin");
});

test("enforceNamespace locks scoped callers to configured namespace", () => {
  const caller = {
    clientId: "client-a",
    requestId: "req-1",
    role: "service",
    namespace: {
      scope: "workspace",
      workspace_id: "repo-a",
      tags: ["shared"]
    }
  };

  const namespace = enforceNamespace({ topic: "search", tags: ["extra"] }, caller);
  assert.deepEqual(namespace, {
    scope: "workspace",
    workspace_id: "repo-a",
    agent_id: null,
    topic: "search",
    tags: ["shared", "extra"]
  });

  assert.throws(
    () => enforceNamespace({ workspace_id: "repo-b" }, caller),
    /not allowed to override namespace field/
  );
});

test("assertNamespaceAccess rejects out-of-scope items", () => {
  const caller = {
    clientId: "client-a",
    requestId: "req-1",
    role: "service",
    namespace: {
      scope: "workspace",
      workspace_id: "repo-a",
      tags: ["shared"]
    }
  };

  assert.doesNotThrow(() => assertNamespaceAccess({
    scope: "workspace",
    workspace_id: "repo-a",
    tags: ["shared", "extra"]
  }, caller));

  assert.throws(
    () => assertNamespaceAccess({
      scope: "workspace",
      workspace_id: "repo-b",
      tags: ["shared"]
    }, caller),
    /not allowed to access this memory item/
  );
});

test("in-memory rate limiter rejects callers over the configured threshold", () => {
  const limiter = new InMemoryRateLimiter({ windowMs: 1000, maxRequests: 2 });
  limiter.consume("client-a", 1000);
  limiter.consume("client-a", 1500);
  assert.throws(() => limiter.consume("client-a", 1800), /Rate limit exceeded/);
  assert.doesNotThrow(() => limiter.consume("client-a", 2501));
});

test("request rate limit key prefers forwarded client IP and falls back to a fingerprint", () => {
  const proxiedRequest = new Request("https://example.test", {
    headers: {
      "x-forwarded-for": "203.0.113.9, 10.0.0.2",
      "user-agent": "agent-a"
    }
  });
  const fallbackRequest = new Request("https://example.test", {
    headers: {
      "user-agent": "agent-b",
      origin: "https://app.example.test"
    }
  });

  assert.equal(getRequestRateLimitKey(proxiedRequest), "ip:203.0.113.9");
  assert.equal(
    getRequestRateLimitKey(fallbackRequest),
    "fingerprint:agent-b:https://app.example.test"
  );
});
