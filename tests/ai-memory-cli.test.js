import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "ai-memory-cli.mjs");

test("cli init creates user-level config and env with expected shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-init-"));
  const configDir = path.join(tempDir, "config");
  const result = runCli(["init"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INIT_URL: "https://example.test/memory",
      AI_MEMORY_INIT_ACCESS_KEY: "secret-123",
      AI_MEMORY_INIT_CLIENT_ID: "client-a"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const envFile = fs.readFileSync(path.join(configDir, "env"), "utf8");

  assert.equal(config.url, "https://example.test/memory");
  assert.equal(config.clientId, "client-a");
  assert.deepEqual(config.installs, {});
  assert.match(envFile, /MEMORY_MCP_ACCESS_KEY="secret-123"/);
});

test("cli install codex stores a named install and writes literal secret-backed config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-codex-"));
  const configDir = path.join(tempDir, "config");
  const codexPath = path.join(tempDir, "project", ".codex", "config.toml");

  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    clientId: "client-a",
    installs: {}
  }, "secret-123");

  const result = runCli(["install", "codex"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INSTALL_NAME: "personal-codex",
      AI_MEMORY_AGENT_ID: "coder-a",
      AI_MEMORY_INSTALL_SCOPE: "global/user",
      AI_MEMORY_CODEX_CONFIG_PATH: codexPath
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const codexConfig = fs.readFileSync(codexPath, "utf8");

  assert.equal(updatedConfig.installs["personal-codex"].type, "codex");
  assert.equal(updatedConfig.installs["personal-codex"].agentId, "coder-a");
  assert.equal(updatedConfig.installs["personal-codex"].scope, "global/user");
  assert.equal(updatedConfig.installs["personal-codex"].path, codexPath);
  assert.match(codexConfig, /x-memory-key = "secret-123"/);
  assert.match(codexConfig, /x-memory-client-id = "client-a"/);
});

test("cli install claude stores a named install and registers literal headers", () => {
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
    clientId: "reviewer-client",
    installs: {}
  }, "secret-xyz");

  const result = runCli(["install", "claude"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INSTALL_NAME: "main-claude",
      AI_MEMORY_AGENT_ID: "reviewer-a",
      CLAUDE_MCP_SCOPE: "user",
      PATH: `${fakeBinDir}:${process.env.PATH}`
    },
    input: ""
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedConfig = JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8"));
  const log = fs.readFileSync(logPath, "utf8");

  assert.equal(updatedConfig.installs["main-claude"].type, "claude");
  assert.equal(updatedConfig.installs["main-claude"].agentId, "reviewer-a");
  assert.equal(updatedConfig.installs["main-claude"].scope, "user");
  assert.match(log, /--header x-memory-key: secret-xyz/);
  assert.match(log, /--header x-memory-client-id: reviewer-client/);
});

test("doctor reports missing files and permission problems", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-doctor-"));
  const configDir = path.join(tempDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
    serverName: "ai-memory",
    url: "https://example.test/memory",
    clientId: "",
    installs: {
      broken: {
        type: "codex",
        agentId: "coder-a",
        scope: "project/local",
        path: path.join(tempDir, "missing.toml")
      }
    }
  }, null, 2));
  fs.writeFileSync(path.join(configDir, "env"), 'MEMORY_MCP_ACCESS_KEY="secret"\n', { mode: 0o644 });

  const result = runCli(["doctor"], {
    cwd: tempDir,
    env: { AI_MEMORY_CONFIG_DIR: configDir }
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Doctor found issues:/);
  assert.match(result.stdout, /missing path/);
  assert.match(result.stdout, /permissions should be 600/);
});

test("duplicate install names can be rejected during install", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-cli-dup-"));
  const configDir = path.join(tempDir, "config");
  seedConfig(configDir, {
    serverName: "ai-memory",
    url: "https://example.test/memory",
    clientId: "",
    installs: {
      "main-codex": {
        type: "codex",
        agentId: "coder-a",
        scope: "project/local",
        path: path.join(tempDir, ".codex", "config.toml")
      }
    }
  }, "secret-123");

  const result = runCli(["install", "codex"], {
    cwd: tempDir,
    env: {
      AI_MEMORY_CONFIG_DIR: configDir,
      AI_MEMORY_INSTALL_NAME: "main-codex",
      AI_MEMORY_OVERWRITE_EXISTING: "false"
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Install cancelled/);
});

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...options.env },
    input: options.input || "",
    encoding: "utf8"
  });
}

function seedConfig(configDir, config, accessKey) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(configDir, "env"), `MEMORY_MCP_ACCESS_KEY="${accessKey}"\n`, { mode: 0o600 });
  fs.chmodSync(path.join(configDir, "env"), 0o600);
}
