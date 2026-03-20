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

test("normalizeUserConfig migrates legacy clientId and installs into install records", () => {
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

  assert.deepEqual(config.installs, {
    claude: {
      authMode: "scoped",
      clientId: "legacy-client",
      serverName: "",
      namespaces: [],
      hosts: []
    }
  });
  assert.equal(config.currentInstallKey, "claude");
});

test("normalizeUserConfig migrates intermediate clients shape into install auth records", () => {
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

  assert.deepEqual(config.installs, {
    claude: {
      authMode: "scoped",
      clientId: "client-a",
      serverName: "",
      namespaces: [],
      hosts: []
    },
    cursor: {
      authMode: "shared",
      clientId: "",
      serverName: "",
      namespaces: [],
      hosts: []
    }
  });
  assert.equal(config.currentInstallKey, "claude");
});

test("addAgentNamespace deduplicates agent namespaces", () => {
  const initial = normalizeUserConfig({
    installs: {
      claude: {
        authMode: "scoped",
        clientId: "client-a",
        serverName: "",
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
    currentInstallKey: "claude"
  });

  const next = addAgentNamespace(initial, "claude", {
    scope: "workspace",
    workspace_id: "/repo",
    agent_id: null,
    topic: null,
    tags: []
  });

  assert.equal(next.installs.claude.namespaces.length, 1);
});

test("resolveHostAgent prefers exact host and falls back to single configured agent", () => {
  const direct = resolveHostAgent(normalizeUserConfig({
    installs: {
      codex: { authMode: "scoped", clientId: "codex-client", serverName: "", namespaces: [] },
      claude: { authMode: "shared", clientId: "", serverName: "", namespaces: [] }
    },
    currentInstallKey: "claude"
  }), "codex");
  assert.equal(direct.match?.agentId, "codex");

  const fallback = resolveHostAgent(normalizeUserConfig({
    installs: {
      "team-reviewer": { authMode: "shared", clientId: "", serverName: "", namespaces: [] }
    },
    currentInstallKey: "team-reviewer"
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
    installs: {
      coderA: {
        type: "codex",
        clientId: "client-a",
        namespaces: []
      }
    },
    currentInstallKey: "coderA"
  }, null, 2));

  writeUserConfig(configPath, normalizeUserConfig(JSON.parse(fs.readFileSync(configPath, "utf8"))));

  const backupsDir = path.join(tempDir, "backups");
  const backups = fs.readdirSync(backupsDir);
  const nextConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(backups.length, 1);
  assert.equal(nextConfig.currentInstallKey, "codex");
  assert.equal(Boolean(nextConfig.clients), false);
});
