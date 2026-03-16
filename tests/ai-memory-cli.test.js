import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "ai-memory-cli.mjs");

test("cli init creates centralized config and env with agent-centric shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-init-"));
  const configDir = path.join(tempDir, "config");
  const result = runCli(["init"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INIT_URL: "https://example.test/memory",
      AI_MEMORY_INIT_ACCESS_KEY: "secret-123",
      AI_MEMORY_INIT_CLIENT_ID: "client-a",
      AI_MEMORY_INIT_AGENT_ID: "claude"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const envFile = fs.readFileSync(path.join(configDir, "env"), "utf8");

  assert.equal(config.url, "https://example.test/memory");
  assert.equal(config.currentAgent, "claude");
  assert.deepEqual(config.agents.claude, {
    authMode: "scoped",
    clientId: "client-a",
    namespaces: []
  });
  assert.equal(Boolean(config.clients), false);
  assert.match(envFile, /MEMORY_MCP_ACCESS_KEY="secret-123"/);
  assert.match(envFile, /MEMORY_MCP_CLIENT_ID="client-a"/);
  assert.match(envFile, /MEMORY_MCP_AGENT_SECRETS_JSON=/);
});

test("cli install codex prefers the codex agent and writes scoped headers", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-codex-"));
  const configDir = path.join(tempDir, "config");
  const codexPath = path.join(tempDir, "project", ".codex", "config.toml");

  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    agents: {
      codex: {
        authMode: "scoped",
        clientId: "client-a",
        namespaces: []
      },
      claude: {
        authMode: "shared",
        clientId: "",
        namespaces: []
      }
    },
    currentAgent: "claude"
  }, "secret-123", {
    codex: { authMode: "scoped", clientId: "client-a", secret: "secret-123" }
  });

  const result = runCli(["install", "codex"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INSTALL_SCOPE: "global/user",
      AI_MEMORY_CODEX_CONFIG_PATH: codexPath
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const codexConfig = fs.readFileSync(codexPath, "utf8");

  assert.equal(updatedConfig.currentAgent, "codex");
  assert.match(codexConfig, /x-memory-key = "secret-123"/);
  assert.match(codexConfig, /x-memory-client-id = "client-a"/);
});

test("cli install claude omits scoped client header for shared auth agents", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-claude-"));
  const configDir = path.join(tempDir, "config");
  const fakeBinDir = path.join(tempDir, "bin");
  const logPath = path.join(tempDir, "claude.log");

  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.writeFileSync(path.join(fakeBinDir, "claude"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1" == "mcp" && "$2" == "get" ]]; then
  exit 1
fi
exit 0
`);
  fs.chmodSync(path.join(fakeBinDir, "claude"), 0o755);

  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    agents: {
      claude: {
        authMode: "shared",
        clientId: "",
        namespaces: []
      }
    },
    currentAgent: "claude"
  }, "secret-xyz", {
    claude: { authMode: "shared", clientId: "", secret: "secret-xyz" }
  });

  const result = runCli(["install", "claude"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      CLAUDE_MCP_SCOPE: "user",
      PATH: `${fakeBinDir}:${process.env.PATH}`
    },
    input: ""
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const log = fs.readFileSync(logPath, "utf8");

  assert.equal(updatedConfig.currentAgent, "claude");
  assert.match(log, /--header x-memory-key: secret-xyz/);
  assert.doesNotMatch(log, /x-memory-client-id/);
});

test("cli install fails clearly when requested host agent is absent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-no-host-"));
  const configDir = path.join(tempDir, "config");
  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    agents: {
      "team-reviewer": {
        authMode: "scoped",
        clientId: "client-a",
        namespaces: []
      },
      "team-coder": {
        authMode: "shared",
        clientId: "",
        namespaces: []
      }
    },
    currentAgent: "team-reviewer"
  }, "secret-123", {
    "team-reviewer": { authMode: "scoped", clientId: "client-a", secret: "secret-123" }
  });

  const result = runCli(["install", "codex"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No 'codex' agent is configured/);
});

test("doctor reports missing currentAgent, invalid shared agent client ids, and missing scoped inventory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-doctor-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
    serverName: "ai-memory",
    url: "https://example.test/memory",
    agents: {
      claude: {
        authMode: "shared",
        clientId: "should-not-exist",
        namespaces: []
      },
      codex: {
        authMode: "scoped",
        clientId: "",
        namespaces: []
      }
    },
    currentAgent: ""
  }, null, 2));
  fs.writeFileSync(path.join(configDir, "env"), 'MEMORY_MCP_ACCESS_KEY="secret"\n', { mode: 0o644 });

  const result = runCli(["doctor"], {
    cwd: tempDir,
    env: { AI_MEMORY_CONFIG_DIR: configDir }
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing 'currentAgent'/);
  assert.match(result.stdout, /Shared agent 'claude' must not define a scoped client ID/);
  assert.match(result.stdout, /Scoped agent 'codex' is missing a scoped client ID/);
  assert.match(result.stdout, /permissions should be 600/);
  assert.match(result.stdout, /MEMORY_MCP_AGENT_SECRETS_JSON/);
});

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...options.env },
    input: options.input || "",
    encoding: "utf8"
  });
}

function seedConfig(configDir, config, accessKey, secrets = {}) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(
    path.join(configDir, "env"),
    `MEMORY_MCP_ACCESS_KEY="${accessKey}"\nMEMORY_MCP_AGENT_SECRETS_JSON=${JSON.stringify(JSON.stringify(secrets))}\n`,
    { mode: 0o600 }
  );
  fs.chmodSync(path.join(configDir, "env"), 0o600);
}
