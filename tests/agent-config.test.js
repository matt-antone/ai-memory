import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  inspectCodexConfig,
  inspectJsonServerConfig,
  removeCodexConfig,
  removeJsonServerConfig,
  upsertCodexConfig,
  upsertJsonServerConfig
} from "../src/utils/agent-config.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures/agent-config");

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

test("codex upsert adds a managed ai-memory block without dropping other sections", () => {
  const initial = `
[other]
value = "keep"
`.trim();

  const next = upsertCodexConfig(initial, "ai-memory", "https://example.test", "");

  assert.match(next, /\[other\]/);
  assert.match(next, /\[mcp_servers\.ai-memory\]/);
  assert.match(next, /# >>> ai-memory managed block >>>/);
});

test("codex upsert can embed a literal access key for user-level installs", () => {
  const next = upsertCodexConfig("", "ai-memory", "https://example.test", "client-a", {
    accessKey: "secret-123"
  });

  assert.match(next, /x-memory-key = "secret-123"/);
  assert.doesNotMatch(next, /bearer_token_env_var/);
  assert.match(next, /x-memory-client-id = "client-a"/);
});

test("codex inspect recognizes managed and unmanaged entries", () => {
  const managed = upsertCodexConfig("", "ai-memory", "https://example.test", "");
  const unmanaged = `
[mcp_servers.ai-memory]
url = "https://example.test"
`.trim();

  assert.deepEqual(inspectCodexConfig(managed, "ai-memory"), { exists: true, managed: true });
  assert.deepEqual(inspectCodexConfig(unmanaged, "ai-memory"), { exists: true, managed: false });
});

test("codex remove deletes the ai-memory block and keeps other content", () => {
  const withServer = upsertCodexConfig(`
[other]
value = "keep"
`.trim(), "ai-memory", "https://example.test", "");

  const next = removeCodexConfig(withServer, "ai-memory");

  assert.doesNotMatch(next, /\[mcp_servers\.ai-memory\]/);
  assert.match(next, /\[other\]/);
});

test("json upsert preserves unrelated servers", () => {
  const initial = JSON.stringify({
    mcpServers: {
      existing: {
        type: "http",
        url: "https://existing.test"
      }
    }
  }, null, 2);

  const next = upsertJsonServerConfig(initial, "ai-memory", "https://example.test", "client-a");
  const parsed = JSON.parse(next);

  assert.equal(parsed.mcpServers.existing.url, "https://existing.test");
  assert.equal(parsed.mcpServers["ai-memory"].headers["x-memory-client-id"], "client-a");
});

test("json upsert supports Cursor env interpolation and env files", () => {
  const next = upsertJsonServerConfig(
    "",
    "ai_memory",
    "https://example.test",
    "client-a",
    { envStyle: "cursor", envFile: "${workspaceFolder}/.env" }
  );
  const parsed = JSON.parse(next);

  assert.equal(parsed.mcpServers.ai_memory.headers["x-memory-key"], "${env:MEMORY_MCP_ACCESS_KEY}");
  assert.equal(parsed.mcpServers.ai_memory.headers["x-memory-client-id"], "client-a");
  assert.equal(parsed.mcpServers.ai_memory.envFile, "${workspaceFolder}/.env");
});

test("json inspect recognizes managed and unmanaged entries", () => {
  const managed = upsertJsonServerConfig("", "ai-memory", "https://example.test", "");
  const unmanaged = JSON.stringify({
    mcpServers: {
      "ai-memory": {
        type: "stdio",
        command: "custom"
      }
    }
  }, null, 2);

  assert.deepEqual(inspectJsonServerConfig(managed, "ai-memory"), { exists: true, managed: true });
  assert.deepEqual(inspectJsonServerConfig(unmanaged, "ai-memory"), { exists: true, managed: false });
});

test("json remove deletes only the selected server", () => {
  const initial = upsertJsonServerConfig(JSON.stringify({
    mcpServers: {
      keep: {
        type: "http",
        url: "https://keep.test"
      }
    }
  }), "ai-memory", "https://example.test", "");

  const next = removeJsonServerConfig(initial, "ai-memory");
  const parsed = JSON.parse(next);

  assert.equal(parsed.mcpServers.keep.url, "https://keep.test");
  assert.equal("ai-memory" in parsed.mcpServers, false);
});

test("golden codex upsert preserves unrelated sections and rewrites only ai-memory", () => {
  const actual = upsertCodexConfig(
    readFixture("codex-input.toml"),
    "ai-memory",
    "https://example.test/memory",
    "client-a"
  );

  assert.equal(actual, readFixture("codex-expected.toml"));
});

test("golden cursor upsert preserves unrelated config and replaces ai-memory entry", () => {
  const actual = upsertJsonServerConfig(
    readFixture("cursor-input.json"),
    "ai_memory",
    "https://example.test/memory",
    "client-a",
    { envStyle: "cursor", envFile: "${workspaceFolder}/.env", aliasesToRemove: ["ai-memory"] }
  );

  assert.equal(actual, `${readFixture("cursor-expected.json").trim()}\n`);
});

test("json upsert can remove a legacy Cursor hyphenated key while writing the normalized key", () => {
  const initial = JSON.stringify({
    mcpServers: {
      "ai-memory": {
        type: "http",
        url: "https://old.test",
        headers: {
          "x-memory-key": "${env:MEMORY_MCP_ACCESS_KEY}"
        }
      }
    }
  }, null, 2);

  const next = upsertJsonServerConfig(
    initial,
    "ai_memory",
    "https://example.test/memory",
    "client-a",
    {
      envStyle: "cursor",
      aliasesToRemove: ["ai-memory"]
    }
  );
  const parsed = JSON.parse(next);

  assert.equal("ai-memory" in parsed.mcpServers, false);
  assert.equal(parsed.mcpServers.ai_memory.url, "https://example.test/memory");
});

test("json upsert stdio Cursor config shape", () => {
  const next = upsertJsonServerConfig("", "ai_memory", "https://ignored.test", "client-a", {
    envStyle: "cursor",
    envFile: "${workspaceFolder}/.env",
    transport: "stdio"
  });
  const parsed = JSON.parse(next);

  assert.equal(parsed.mcpServers.ai_memory.type, "stdio");
  assert.equal(parsed.mcpServers.ai_memory.command, "ai-memory");
  assert.deepEqual(parsed.mcpServers.ai_memory.args, ["mcp"]);
  assert.equal(parsed.mcpServers.ai_memory.env.MEMORY_MCP_CLIENT_ID, "client-a");
  assert.equal(parsed.mcpServers.ai_memory.env.MEMORY_MCP_ACCESS_KEY, "${env:MEMORY_MCP_ACCESS_KEY}");
});

test("json inspect recognizes managed ai-memory stdio entry", () => {
  const raw = JSON.stringify({
    mcpServers: {
      ai_memory: {
        type: "stdio",
        command: "ai-memory",
        args: ["mcp"],
        env: { MEMORY_MCP_ACCESS_KEY: "${env:MEMORY_MCP_ACCESS_KEY}" }
      }
    }
  }, null, 2);

  assert.deepEqual(inspectJsonServerConfig(raw, "ai_memory"), { exists: true, managed: true });
});

test("golden openclaw upsert preserves gateway settings and rewrites ai-memory entry", () => {
  const actual = upsertJsonServerConfig(
    readFixture("openclaw-input.json"),
    "ai-memory",
    "https://example.test/memory",
    ""
  );

  assert.equal(actual, `${readFixture("openclaw-expected.json").trim()}\n`);
});
