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
    "ai-memory",
    "https://example.test",
    "client-a",
    { envStyle: "cursor", envFile: "${workspaceFolder}/.env" }
  );
  const parsed = JSON.parse(next);

  assert.equal(parsed.mcpServers["ai-memory"].headers["x-memory-key"], "${env:MEMORY_MCP_ACCESS_KEY}");
  assert.equal(parsed.mcpServers["ai-memory"].headers["x-memory-client-id"], "client-a");
  assert.equal(parsed.mcpServers["ai-memory"].envFile, "${workspaceFolder}/.env");
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
    "ai-memory",
    "https://example.test/memory",
    "client-a",
    { envStyle: "cursor", envFile: "${workspaceFolder}/.env" }
  );

  assert.equal(actual, `${readFixture("cursor-expected.json").trim()}\n`);
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
