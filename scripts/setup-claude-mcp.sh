#!/usr/bin/env bash

set -euo pipefail

SERVER_NAME="${CLAUDE_MCP_SERVER_NAME:-ai-memory}"
SCOPE="${CLAUDE_MCP_SCOPE:-project}"
DEFAULT_URL=process.env.MEMORY_MCP_URL
URL="${1:-${MEMORY_MCP_URL:-$DEFAULT_URL}}"

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: Claude Code CLI ('claude') is not installed or not on PATH." >&2
  exit 1
fi

if [[ -z "${MEMORY_MCP_ACCESS_KEY:-}" ]]; then
  echo "Error: MEMORY_MCP_ACCESS_KEY must be set in your environment." >&2
  exit 1
fi

if [[ "$SCOPE" != "project" && "$SCOPE" != "user" && "$SCOPE" != "local" ]]; then
  echo "Error: CLAUDE_MCP_SCOPE must be one of: project, user, local." >&2
  exit 1
fi

key_header='x-memory-key: ${MEMORY_MCP_ACCESS_KEY}'

cmd=(
  claude
  mcp
  add
  --transport http
  --scope "$SCOPE"
  "$SERVER_NAME"
  "$URL"
)

if [[ -n "${MEMORY_MCP_CLIENT_ID:-}" ]]; then
  client_header='x-memory-client-id: ${MEMORY_MCP_CLIENT_ID}'
  cmd+=(--header "$client_header")
fi

cmd+=(--header "$key_header")

echo "Registering Claude MCP server '$SERVER_NAME' at:"
echo "  $URL"
echo
claude mcp remove --scope "$SCOPE" "$SERVER_NAME" >/dev/null 2>&1 || true
"${cmd[@]}"
echo
echo "Verifying registration:"
claude mcp get "$SERVER_NAME" || claude mcp list
