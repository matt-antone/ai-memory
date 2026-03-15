#!/usr/bin/env bash

set -euo pipefail

SERVER_NAME="${CODEX_MCP_SERVER_NAME:-ai-memory}"
CONFIG_DIR="${HOME}/.codex"
CONFIG_PATH="${CONFIG_DIR}/config.toml"
DEFAULT_URL=process.env.MEMORY_MCP_URL
URL="${1:-${MEMORY_MCP_URL:-$DEFAULT_URL}}"
START_MARKER="# >>> ai-memory managed block >>>"
END_MARKER="# <<< ai-memory managed block <<<"

mkdir -p "$CONFIG_DIR"
touch "$CONFIG_PATH"

if grep -q '^\[mcp_servers\.ai-memory\]' "$CONFIG_PATH" && ! grep -qF "$START_MARKER" "$CONFIG_PATH"; then
  echo "Error: $CONFIG_PATH already contains an unmanaged [mcp_servers.ai-memory] entry." >&2
  echo "Please remove or migrate that block before running this setup script." >&2
  exit 1
fi

tmp_file="$(mktemp)"
awk -v start="$START_MARKER" -v end="$END_MARKER" '
  $0 == start { skip = 1; next }
  $0 == end { skip = 0; next }
  skip != 1 { print }
' "$CONFIG_PATH" > "$tmp_file"

mv "$tmp_file" "$CONFIG_PATH"

{
  printf "\n%s\n" "$START_MARKER"
  printf "[mcp_servers.%s]\n" "$SERVER_NAME"
  printf "url = \"%s\"\n" "$URL"
  printf "bearer_token_env_var = \"MEMORY_MCP_ACCESS_KEY\"\n\n"
  printf "[mcp_servers.%s.http_headers]\n" "$SERVER_NAME"
  printf "x-memory-key = \"MCP_BEARER_TOKEN\"\n"
  if [[ -n "${MEMORY_MCP_CLIENT_ID:-}" ]]; then
    printf "x-memory-client-id = \"%s\"\n" "$MEMORY_MCP_CLIENT_ID"
  fi
  printf "%s\n" "$END_MARKER"
} >> "$CONFIG_PATH"

echo "Wrote Codex MCP config for '$SERVER_NAME' to:"
echo "  $CONFIG_PATH"
echo
echo "Restart Codex after config changes so it reloads MCP servers."
