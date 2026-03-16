import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "ai-memory-cli.mjs");

test("cli init creates centralized config and env with install-centric shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-init-"));
  const configDir = path.join(tempDir, "config");
  const result = runCli(["init"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INIT_URL: "https://example.test/memory",
      AI_MEMORY_INIT_ACCESS_KEY: "secret-123",
      AI_MEMORY_INIT_CLIENT_ID: "client-a",
      AI_MEMORY_INIT_INSTALL_KEY: "claude"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const envFile = fs.readFileSync(path.join(configDir, "env"), "utf8");

  assert.equal(config.url, "https://example.test/memory");
  assert.equal(config.currentInstallKey, "claude");
  assert.deepEqual(config.installs.claude, {
    authMode: "scoped",
    clientId: "client-a",
    serverName: "",
    namespaces: []
  });
  assert.equal(Boolean(config.clients), false);
  assert.match(envFile, /MEMORY_MCP_ACCESS_KEY="secret-123"/);
  assert.match(envFile, /MEMORY_MCP_CLIENT_ID="client-a"/);
  assert.match(envFile, /MEMORY_MCP_AGENT_SECRETS_JSON=/);
});

test("cli install codex uses current install key identity and writes scoped headers", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-codex-"));
  const configDir = path.join(tempDir, "config");
  const codexPath = path.join(tempDir, "project", ".codex", "config.toml");

  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    installs: {
      "team-reviewer": {
        authMode: "scoped",
        clientId: "client-a",
        namespaces: []
      },
      "team-shared": {
        authMode: "shared",
        clientId: "",
        namespaces: []
      }
    },
    currentInstallKey: "team-reviewer"
  }, "secret-123", {
    "team-reviewer": { authMode: "scoped", clientId: "client-a", secret: "secret-123" }
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

  assert.equal(updatedConfig.currentInstallKey, "team-reviewer");
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
    installs: {
      claude: {
        authMode: "shared",
        clientId: "",
        serverName: "",
        namespaces: []
      }
    },
    currentInstallKey: "claude"
  }, "secret-xyz", {
    claude: { authMode: "shared", clientId: "", secret: "secret-xyz" }
  });

  const result = runCli(["install", "claude"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_SERVER_NAME: "ai-memory",
      CLAUDE_MCP_SCOPE: "user",
      PATH: `${fakeBinDir}:${process.env.PATH}`
    },
    input: ""
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const log = fs.readFileSync(logPath, "utf8");

  assert.equal(updatedConfig.currentInstallKey, "claude");
  assert.match(log, /--header x-memory-key: secret-xyz/);
  assert.doesNotMatch(log, /x-memory-client-id/);
});

test("cli install cursor normalizes server key and writes literal auth header", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-cursor-"));
  const configDir = path.join(tempDir, "config");
  const cursorPath = path.join(tempDir, ".cursor", "mcp.json");

  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    installs: {
      cursor: {
        authMode: "scoped",
        clientId: "cursor-memory",
        serverName: "",
        namespaces: []
      }
    },
    currentInstallKey: "cursor"
  }, "secret-cursor", {
    cursor: { authMode: "scoped", clientId: "cursor-memory", secret: "secret-cursor" }
  });

  const result = runCli(["install", "cursor"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INSTALL_SCOPE: "global/user",
      AI_MEMORY_CURSOR_CONFIG_PATH: cursorPath,
      AI_MEMORY_OVERWRITE_EXISTING: "true"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(fs.readFileSync(cursorPath, "utf8"));
  assert.equal(Boolean(parsed.mcpServers.ai_memory), true);
  assert.equal(Boolean(parsed.mcpServers["ai-memory"]), false);
  assert.equal(parsed.mcpServers.ai_memory.headers["x-memory-key"], "secret-cursor");
  assert.equal(parsed.mcpServers.ai_memory.headers["x-memory-client-id"], "cursor-memory");
});

test("cli install claude uses and persists a custom MCP server name", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-claude-name-"));
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
    installs: {
      claude: {
        authMode: "shared",
        clientId: "",
        serverName: "",
        namespaces: []
      }
    },
    currentInstallKey: "claude"
  }, "secret-xyz", {
    claude: { authMode: "shared", clientId: "", secret: "secret-xyz" }
  });

  const result = runCli(["install", "claude"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_SERVER_NAME: "ai-memory-reviewer-a",
      CLAUDE_MCP_SCOPE: "project",
      PATH: `${fakeBinDir}:${process.env.PATH}`
    },
    input: ""
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const log = fs.readFileSync(logPath, "utf8");

  assert.equal(updatedConfig.installs.claude.serverName, "ai-memory-reviewer-a");
  assert.match(log, /mcp get --scope project ai-memory-reviewer-a/);
  assert.match(log, /mcp add --transport http --scope project ai-memory-reviewer-a https:\/\/example\.test\/memory/);
});

test("cli install falls back to normalized install key when current is unset", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-no-host-"));
  const configDir = path.join(tempDir, "config");
  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    installs: {
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
    currentInstallKey: ""
  }, "secret-123", {
    "team-reviewer": { authMode: "scoped", clientId: "client-a", secret: "secret-123" }
  });

  const result = runCli(["install", "codex"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INSTALL_SCOPE: "global/user",
      AI_MEMORY_CODEX_CONFIG_PATH: path.join(tempDir, "project", ".codex", "config.toml")
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  assert.equal(updatedConfig.currentInstallKey, "team-reviewer");
});

test("doctor reports missing currentInstallKey, invalid shared install client ids, and missing scoped inventory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-doctor-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
    serverName: "ai-memory",
    url: "https://example.test/memory",
    installs: {
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
    currentInstallKey: ""
  }, null, 2));
  fs.writeFileSync(path.join(configDir, "env"), 'MEMORY_MCP_ACCESS_KEY="secret"\n', { mode: 0o644 });

  const result = runCli(["doctor"], {
    cwd: tempDir,
    env: { AI_MEMORY_CONFIG_DIR: configDir }
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing 'currentInstallKey'/);
  assert.match(result.stdout, /Shared install 'claude' must not define a scoped client ID/);
  assert.match(result.stdout, /Scoped install 'codex' is missing a scoped client ID/);
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
