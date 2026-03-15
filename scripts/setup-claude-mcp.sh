#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/mcp-config-common.sh"

SERVER_NAME="${CLAUDE_MCP_SERVER_NAME:-ai-memory}"
DEFAULT_URL="https://your-project-ref.supabase.co/functions/v1/memory-mcp"
URL="${1:-${MEMORY_MCP_URL:-$DEFAULT_URL}}"

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: Claude Code CLI ('claude') is not installed or not on PATH." >&2
  exit 1
fi

if [[ -z "${MEMORY_MCP_ACCESS_KEY:-}" ]]; then
  echo "Error: MEMORY_MCP_ACCESS_KEY must be set in your environment." >&2
  exit 1
fi

scope="${CLAUDE_MCP_SCOPE:-}"
if [[ -z "$scope" ]]; then
  choice="$(prompt_choice "Where should Claude store the ai-memory config?" 1 "project" "user" "local")"
  scope="$choice"
fi

if [[ "$scope" != "project" && "$scope" != "user" && "$scope" != "local" ]]; then
  echo "Error: Claude scope must be one of: project, user, local." >&2
  exit 1
fi

key_header='x-memory-key: ${MEMORY_MCP_ACCESS_KEY}'
cmd=(
  claude
  mcp
  add
  --transport http
  --scope "$scope"
  "$SERVER_NAME"
  "$URL"
)

if [[ -n "${MEMORY_MCP_CLIENT_ID:-}" ]]; then
  client_header='x-memory-client-id: ${MEMORY_MCP_CLIENT_ID}'
  cmd+=(--header "$client_header")
fi
cmd+=(--header "$key_header")

exists=0
if claude mcp get --scope "$scope" "$SERVER_NAME" >/dev/null 2>&1; then
  exists=1
elif claude mcp get "$SERVER_NAME" --scope "$scope" >/dev/null 2>&1; then
  exists=1
fi

if [[ "$exists" == "1" ]]; then
  conflict_mode="${AI_MEMORY_CONFLICT_MODE:-}"
  if [[ -z "$conflict_mode" ]]; then
    conflict_mode="$(choose_conflict_mode "Claude" "$scope" "claude mcp scope $scope" "managed")"
  fi
  claude mcp remove --scope "$scope" "$SERVER_NAME" >/dev/null 2>&1 || true
fi

echo "Registering Claude MCP server '$SERVER_NAME' in scope '$scope' at:"
echo "  $URL"
echo
"${cmd[@]}"
echo
echo "Verifying registration:"
claude mcp get --scope "$scope" "$SERVER_NAME" || claude mcp list
echo
echo "Launch Claude with the required ai-memory environment exported:"
echo "  cd \"$PWD\" && set -a && source .env && set +a && claude"
