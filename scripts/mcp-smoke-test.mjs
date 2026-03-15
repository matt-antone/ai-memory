const endpoint = process.env.MEMORY_MCP_SMOKE_URL || process.env.MEMORY_MCP_URL;
const accessKey = process.env.MEMORY_MCP_ACCESS_KEY;
const clientId = process.env.MEMORY_MCP_CLIENT_ID ?? "";

if (!endpoint || !accessKey) {
  console.error("Set MEMORY_MCP_URL (or MEMORY_MCP_SMOKE_URL) and MEMORY_MCP_ACCESS_KEY");
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "x-memory-key": accessKey
};

if (clientId) {
  headers["x-memory-client-id"] = clientId;
}

const steps = [
  { name: "initialize", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke-test", version: "1.0.0" } } } },
  { name: "tools/list", body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } },
  { name: "memory.write", body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory.write", arguments: { kind: "fact", content: "smoke test fact", namespace: { scope: "workspace", workspace_id: "smoke-test" } } } } },
  { name: "memory.search", body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "memory.search", arguments: { query: "smoke test fact", namespace: { scope: "workspace", workspace_id: "smoke-test" }, mode: "lexical" } } } }
];

for (const step of steps) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(step.body)
  });
  const payload = await response.text();
  if (!response.ok) {
    console.error(`${step.name} failed: ${response.status} ${payload}`);
    process.exit(1);
  }
  console.log(`${step.name}: ok`);
}
