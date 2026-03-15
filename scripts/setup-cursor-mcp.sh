#!/usr/bin/env bash

set -euo pipefail

SERVER_NAME="${CURSOR_MCP_SERVER_NAME:-ai-memory}"
CONFIG_DIR=".cursor"
CONFIG_PATH="${CONFIG_DIR}/mcp.json"
DEFAULT_URL=process.env.MEMORY_MCP_URL
URL="${1:-${MEMORY_MCP_URL:-$DEFAULT_URL}}"

mkdir -p "$CONFIG_DIR"

node --input-type=module - "$CONFIG_PATH" "$SERVER_NAME" "$URL" <<'EOF'
import fs from "node:fs";

const [, , configPath, serverName, url] = process.argv;

let data = { mcpServers: {} };
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (raw) {
    data = JSON.parse(raw);
  }
}

if (!data || typeof data !== "object" || Array.isArray(data)) {
  throw new Error("Cursor MCP config must be a JSON object");
}

if (!data.mcpServers || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers)) {
  data.mcpServers = {};
}

const headers = {
  "x-memory-key": "${MEMORY_MCP_ACCESS_KEY}"
};

if (process.env.MEMORY_MCP_CLIENT_ID) {
  headers["x-memory-client-id"] = "${MEMORY_MCP_CLIENT_ID}";
}

data.mcpServers[serverName] = {
  type: "http",
  url,
  headers
};

fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`);
EOF

echo "Wrote Cursor MCP config for '$SERVER_NAME' to:"
echo "  $CONFIG_PATH"
echo
echo "Open Cursor and make sure the server is enabled in Settings -> MCP."
