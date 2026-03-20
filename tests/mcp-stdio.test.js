import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const cliPath = path.join(root, "scripts", "ai-memory-cli.mjs");

test("stdio MCP lists memory tools", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp"],
    env: {
      ...process.env,
      AI_MEMORY_MCP_TEST_IN_MEMORY: "1",
      MEMORY_MCP_ACCESS_KEY: "test-secret-key-for-stdio",
      SUPABASE_URL: "https://unused.test",
      SUPABASE_SERVICE_ROLE_KEY: "unused"
    }
  });
  const client = new Client({ name: "ai-memory-test", version: "0.0.1" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.ok(names.includes("memory.write"));
    assert.ok(names.includes("memory.search"));
  } finally {
    await transport.close();
  }
});

test("stdio MCP memory.write round-trip (in-memory store)", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp"],
    env: {
      ...process.env,
      AI_MEMORY_MCP_TEST_IN_MEMORY: "1",
      MEMORY_MCP_ACCESS_KEY: "test-secret-key-for-stdio",
      SUPABASE_URL: "https://unused.test",
      SUPABASE_SERVICE_ROLE_KEY: "unused"
    }
  });
  const client = new Client({ name: "ai-memory-test", version: "0.0.1" });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "memory.write",
      arguments: {
        kind: "fact",
        content: "stdio integration test item",
        namespace: { repo_url: "https://github.com/test/repo" }
      }
    });
    assert.ok(result.content?.length > 0);
    const text = result.content.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, undefined);
    assert.ok(parsed.id);
  } finally {
    await transport.close();
  }
});
