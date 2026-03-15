#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/mcp-config-common.sh"

SERVER_NAME="${CURSOR_MCP_SERVER_NAME:-ai-memory}"
DEFAULT_URL="https://your-project-ref.supabase.co/functions/v1/memory-mcp"
URL="${1:-${MEMORY_MCP_URL:-$DEFAULT_URL}}"
CLIENT_ID="${MEMORY_MCP_CLIENT_ID:-}"

global_path="${HOME}/.cursor/mcp.json"
local_path="${PWD}/.cursor/mcp.json"

scope="${AI_MEMORY_INSTALL_SCOPE:-}"
if [[ -z "$scope" ]]; then
  scope="$(choose_install_scope "Cursor")"
fi

case "$scope" in
  "project/local")
    config_path="$local_path"
    upsert_options='{"envStyle":"cursor","envFile":"${workspaceFolder}/.env"}'
    ;;
  "global/user")
    config_path="$global_path"
    upsert_options='{"envStyle":"cursor"}'
    ;;
  *)
    echo "Unsupported Cursor install scope: $scope" >&2
    exit 1
    ;;
esac

ensure_parent_dir "$config_path"
inspect_json="$(node "$SCRIPT_DIR/agent-config.mjs" json inspect "$config_path" "$SERVER_NAME")"
exists="$(node -e 'const v = JSON.parse(process.argv[1]); console.log(v.exists ? "1" : "0");' "$inspect_json")"
managed="$(node -e 'const v = JSON.parse(process.argv[1]); console.log(v.managed ? "1" : "0");' "$inspect_json")"

if [[ "$exists" == "1" ]]; then
  conflict_mode="${AI_MEMORY_CONFLICT_MODE:-}"
  if [[ -z "$conflict_mode" ]]; then
    if [[ "$managed" == "1" ]]; then
      conflict_mode="$(choose_conflict_mode "Cursor" "$scope" "$config_path" "managed")"
    else
      conflict_mode="$(choose_conflict_mode "Cursor" "$scope" "$config_path" "unmanaged")"
    fi
  fi

  if [[ "$conflict_mode" == "overwrite" && "$managed" != "1" ]]; then
    confirm "Overwrite the unmanaged Cursor ai-memory entry at $config_path?" "N" || exit 0
  fi

  backup_file "$config_path" >/dev/null || true
fi

node "$SCRIPT_DIR/agent-config.mjs" json upsert "$config_path" "$SERVER_NAME" "$URL" "$CLIENT_ID" "$upsert_options"

echo "Wrote Cursor MCP config for '$SERVER_NAME' to:"
echo "  $config_path"
echo
if [[ "$scope" == "project/local" ]]; then
  echo "Open Cursor in this repo and confirm the project MCP server is enabled."
else
  echo "Open Cursor and confirm the global MCP server is enabled."
fi
