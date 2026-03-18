import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryRateLimiter,
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
        secret: "client-secret"
      }
    ])]
  ]));

  assert.equal(policy.adminSecrets.includes("admin-secret"), true);
  assert.equal(policy.clients.get("client-a").clientId, "client-a");
  // namespace is no longer stored on client entries
  assert.equal(policy.clients.get("client-a").namespace, undefined);
});

test("authenticateRequest accepts scoped clients and shared admin keys", () => {
  const policy = loadRuntimePolicy(new Map([
    ["MEMORY_MCP_ACCESS_KEY", "admin-secret"],
    ["MEMORY_MCP_CLIENTS_JSON", JSON.stringify([
      {
        client_id: "client-a",
        secret: "client-secret"
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
  assert.equal(admin.role, "admin");
  // namespace field no longer returned on caller
  assert.equal(client.namespace, undefined);
});

test("enforceNamespace stamps agent from caller.clientId and derives repo_name", () => {
  const caller = { clientId: "codex", requestId: "req-1", role: "service" };

  const ns = enforceNamespace({ repo_url: "https://github.com/user/my-repo" }, caller);
  assert.equal(ns.agent, "codex");
  assert.equal(ns.repo_url, "https://github.com/user/my-repo");
  assert.equal(ns.repo_name, "my-repo");
});

test("enforceNamespace rejects caller-supplied agent", () => {
  const caller = { clientId: "codex", requestId: "req-1", role: "service" };
  assert.throws(
    () => enforceNamespace({ agent: "hacker" }, caller),
    /agent is set by auth/
  );
});

test("enforceNamespace rejects caller-supplied repo_name", () => {
  const caller = { clientId: "codex", requestId: "req-1", role: "service" };
  assert.throws(
    () => enforceNamespace({ repo_name: "spoofed" }, caller),
    /repo_name is derived automatically/
  );
});

test("enforceNamespace handles null repo_url (global)", () => {
  const caller = { clientId: "claude", requestId: "req-2", role: "service" };
  const ns = enforceNamespace({}, caller);
  assert.equal(ns.agent, "claude");
  assert.equal(ns.repo_url, null);
  assert.equal(ns.repo_name, null);
});

test("in-memory rate limiter rejects callers over the configured threshold", () => {
  const limiter = new InMemoryRateLimiter({ windowMs: 1000, maxRequests: 2 });
  limiter.consume("client-a", 1000);
  limiter.consume("client-a", 1500);
  assert.throws(() => limiter.consume("client-a", 1800), /Rate limit exceeded/);
  assert.doesNotThrow(() => limiter.consume("client-a", 2501));
});

test("request rate limit key prefers platform IP headers over x-forwarded-for", () => {
  const platformRequest = new Request("https://example.test", {
    headers: {
      "cf-connecting-ip": "198.51.100.1",
      "x-forwarded-for": "203.0.113.9, 10.0.0.2",
      "user-agent": "agent-a"
    }
  });
  const forwardedOnlyRequest = new Request("https://example.test", {
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

  assert.equal(getRequestRateLimitKey(platformRequest), "ip:198.51.100.1");
  assert.equal(getRequestRateLimitKey(forwardedOnlyRequest), "ip:203.0.113.9");
  assert.equal(
    getRequestRateLimitKey(fallbackRequest),
    "fingerprint:agent-b:https://app.example.test"
  );
});
