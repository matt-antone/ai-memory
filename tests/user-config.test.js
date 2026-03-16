import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addAgentNamespace,
  normalizeUserConfig,
  resolveHostAgent,
  writeUserConfig
} from "../src/utils/user-config.js";

test("normalizeUserConfig migrates legacy clientId and installs into host agents", () => {
  const config = normalizeUserConfig({
    serverName: "ai-memory",
    url: "https://example.test/memory",
    clientId: "legacy-client",
    installs: {
      claude: {
        type: "claude",
        agentId: "reviewer-a",
        scope: "project"
      }
    }
  });

  assert.deepEqual(config.agents, {
    claude: {
      authMode: "scoped",
      clientId: "legacy-client",
      namespaces: []
    }
  });
  assert.equal(config.currentAgent, "claude");
});

test("normalizeUserConfig migrates intermediate clients shape into agent auth records", () => {
  const config = normalizeUserConfig({
    serverName: "ai-memory",
    url: "https://example.test/memory",
    clients: {
      "client-a": { authMode: "scoped" },
      "shared-memory": { authMode: "shared" }
    },
    agents: {
      reviewerA: {
        type: "claude",
        clientId: "client-a",
        namespaces: []
      },
      cursor: {
        clientId: "shared-memory",
        namespaces: []
      }
    },
    currentAgent: "reviewerA"
  });

  assert.deepEqual(config.agents, {
    claude: {
      authMode: "scoped",
      clientId: "client-a",
      namespaces: []
    },
    cursor: {
      authMode: "shared",
      clientId: "",
      namespaces: []
    }
  });
  assert.equal(config.currentAgent, "claude");
});

test("addAgentNamespace deduplicates agent namespaces", () => {
  const initial = normalizeUserConfig({
    agents: {
      claude: {
        authMode: "scoped",
        clientId: "client-a",
        namespaces: [
          {
            scope: "workspace",
            workspace_id: "/repo",
            agent_id: null,
            topic: null,
            tags: []
          }
        ]
      }
    },
    currentAgent: "claude"
  });

  const next = addAgentNamespace(initial, "claude", {
    scope: "workspace",
    workspace_id: "/repo",
    agent_id: null,
    topic: null,
    tags: []
  });

  assert.equal(next.agents.claude.namespaces.length, 1);
});

test("resolveHostAgent prefers exact host and falls back to single configured agent", () => {
  const direct = resolveHostAgent(normalizeUserConfig({
    agents: {
      codex: { authMode: "scoped", clientId: "codex-client", namespaces: [] },
      claude: { authMode: "shared", clientId: "", namespaces: [] }
    },
    currentAgent: "claude"
  }), "codex");
  assert.equal(direct.match?.agentId, "codex");

  const fallback = resolveHostAgent(normalizeUserConfig({
    agents: {
      "team-reviewer": { authMode: "shared", clientId: "", namespaces: [] }
    },
    currentAgent: "team-reviewer"
  }), "claude");
  assert.equal(fallback.match?.agentId, "team-reviewer");
});

test("writeUserConfig creates a backup before migrating legacy or intermediate config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-user-config-"));
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    serverName: "ai-memory",
    url: "https://example.test/memory",
    clients: {
      "client-a": { authMode: "scoped" }
    },
    agents: {
      coderA: {
        type: "codex",
        clientId: "client-a",
        namespaces: []
      }
    },
    currentAgent: "coderA"
  }, null, 2));

  writeUserConfig(configPath, normalizeUserConfig(JSON.parse(fs.readFileSync(configPath, "utf8"))));

  const backupsDir = path.join(tempDir, "backups");
  const backups = fs.readdirSync(backupsDir);
  const nextConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(backups.length, 1);
  assert.equal(nextConfig.currentAgent, "codex");
  assert.equal(Boolean(nextConfig.clients), false);
});
