#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/mcp-config-common.sh"

SERVER_NAME="${AI_MEMORY_SERVER_NAME:-ai-memory}"
CODEX_SERVER_NAME="${CODEX_MCP_SERVER_NAME:-$SERVER_NAME}"
CURSOR_SERVER_NAME="${CURSOR_MCP_SERVER_NAME:-$SERVER_NAME}"
CLAUDE_SERVER_NAME="${CLAUDE_MCP_SERVER_NAME:-$SERVER_NAME}"
OPENCLAW_SERVER_NAME="${OPENCLAW_MCP_SERVER_NAME:-$SERVER_NAME}"

declare -a TARGET_LABELS=()
declare -a TARGET_AGENTS=()
declare -a TARGET_SCOPES=()
declare -a TARGET_KINDS=()
declare -a TARGET_PATHS=()
declare -a TARGET_SERVER_NAMES=()

register_target() {
  TARGET_LABELS+=("$1")
  TARGET_AGENTS+=("$2")
  TARGET_SCOPES+=("$3")
  TARGET_KINDS+=("$4")
  TARGET_PATHS+=("$5")
  TARGET_SERVER_NAMES+=("$6")
}

inspect_file_target() {
  local label="$1"
  local agent="$2"
  local scope="$3"
  local kind="$4"
  local path="$5"
  local server_name="$6"

  [[ -f "$path" ]] || return 0
  local inspect_json
  inspect_json="$(node "$SCRIPT_DIR/agent-config.mjs" "$kind" inspect "$path" "$server_name")"
  local exists
  exists="$(node -e 'const v = JSON.parse(process.argv[1]); console.log(v.exists ? "1" : "0");' "$inspect_json")"
  if [[ "$exists" == "1" ]]; then
    register_target "$label" "$agent" "$scope" "$kind" "$path" "$server_name"
  fi
}

inspect_file_target "Codex project/local ($PWD/.codex/config.toml)" "codex" "project/local" "codex" "$PWD/.codex/config.toml" "$CODEX_SERVER_NAME"
inspect_file_target "Codex global/user ($HOME/.codex/config.toml)" "codex" "global/user" "codex" "$HOME/.codex/config.toml" "$CODEX_SERVER_NAME"
inspect_file_target "Cursor project/local ($PWD/.cursor/mcp.json)" "cursor" "project/local" "json" "$PWD/.cursor/mcp.json" "$CURSOR_SERVER_NAME"
inspect_file_target "Cursor global/user ($HOME/.cursor/mcp.json)" "cursor" "global/user" "json" "$HOME/.cursor/mcp.json" "$CURSOR_SERVER_NAME"
inspect_file_target "OpenClaw project/local ($PWD/.openclaw/openclaw.json)" "openclaw" "project/local" "json" "$PWD/.openclaw/openclaw.json" "$OPENCLAW_SERVER_NAME"
inspect_file_target "OpenClaw global/user ($HOME/.openclaw/openclaw.json)" "openclaw" "global/user" "json" "$HOME/.openclaw/openclaw.json" "$OPENCLAW_SERVER_NAME"

if command -v claude >/dev/null 2>&1; then
  for scope in project user local; do
    if claude mcp get --scope "$scope" "$CLAUDE_SERVER_NAME" >/dev/null 2>&1 \
      || claude mcp get "$CLAUDE_SERVER_NAME" --scope "$scope" >/dev/null 2>&1; then
      register_target "Claude $scope scope" "claude" "$scope" "claude" "$scope" "$CLAUDE_SERVER_NAME"
    fi
  done
fi

if [[ "${#TARGET_LABELS[@]}" -eq 0 ]]; then
  echo "No ai-memory installs were detected for Codex, Cursor, Claude, or OpenClaw."
  exit 0
fi

echo "Detected ai-memory installs:"
for i in "${!TARGET_LABELS[@]}"; do
  echo "  $((i + 1))) ${TARGET_LABELS[$i]}"
done
echo
read -r -p "Choose one install to remove [1]: " selection
selection="${selection:-1}"
if ! [[ "$selection" =~ ^[0-9]+$ ]] || (( selection < 1 || selection > ${#TARGET_LABELS[@]} )); then
  echo "Invalid selection." >&2
  exit 1
fi

index=$((selection - 1))
agent="${TARGET_AGENTS[$index]}"
scope="${TARGET_SCOPES[$index]}"
kind="${TARGET_KINDS[$index]}"
path="${TARGET_PATHS[$index]}"
server_name="${TARGET_SERVER_NAMES[$index]}"

echo "Removing ${TARGET_LABELS[$index]}"

if [[ "$kind" == "claude" ]]; then
  claude mcp remove --scope "$scope" "$server_name"
  echo "Removed Claude MCP server '$server_name' from scope '$scope'."
  exit 0
fi

backup_file "$path" >/dev/null || true
node "$SCRIPT_DIR/agent-config.mjs" "$kind" remove "$path" "$server_name"
echo "Removed '$server_name' from $path"
