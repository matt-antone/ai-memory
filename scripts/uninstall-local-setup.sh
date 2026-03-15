#!/usr/bin/env bash

set -euo pipefail

SERVER_NAME="${AI_MEMORY_SERVER_NAME:-ai-memory}"
CODEX_SERVER_NAME="${CODEX_MCP_SERVER_NAME:-$SERVER_NAME}"
CURSOR_SERVER_NAME="${CURSOR_MCP_SERVER_NAME:-$SERVER_NAME}"
CLAUDE_SERVER_NAME="${CLAUDE_MCP_SERVER_NAME:-$SERVER_NAME}"
CLAUDE_SCOPE="${CLAUDE_MCP_SCOPE:-project}"

CODEX_CONFIG_PATH="${HOME}/.codex/config.toml"
CURSOR_CONFIG_PATH=".cursor/mcp.json"
CLAUDE_BACKUP_CANDIDATES=(
  "${PWD}/.mcp.json"
  "${HOME}/.claude.json"
  "${HOME}/.claude/settings.json"
)

timestamp="$(date +"%Y%m%d-%H%M%S")"

confirm() {
  local prompt="$1"
  local answer
  read -r -p "$prompt [y/N] " answer
  answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
  case "$answer" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

backup_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    return 1
  fi

  local backup_path="${path}.ai-memory-backup-${timestamp}"
  cp "$path" "$backup_path"
  echo "Backed up: $path"
  echo "         -> $backup_path"
  return 0
}

remove_codex_server() {
  if [[ ! -f "$CODEX_CONFIG_PATH" ]]; then
    echo "Codex config not found, skipping: $CODEX_CONFIG_PATH"
    return
  fi

  if ! grep -q "^\[mcp_servers\.${CODEX_SERVER_NAME//./\\.}\]" "$CODEX_CONFIG_PATH"; then
    echo "No Codex MCP server named '$CODEX_SERVER_NAME' found in $CODEX_CONFIG_PATH"
    return
  fi

  backup_file "$CODEX_CONFIG_PATH" >/dev/null

  local tmp_file
  tmp_file="$(mktemp)"

  node --input-type=module - "$CODEX_CONFIG_PATH" "$tmp_file" "$CODEX_SERVER_NAME" <<'EOF'
import fs from "node:fs";

const [, , inputPath, outputPath, serverName] = process.argv;
const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/);
const rootHeader = `[mcp_servers.${serverName}]`;
const nestedPrefix = `[mcp_servers.${serverName}.`;
let skip = false;

const kept = lines.filter((line) => {
  const trimmed = line.trim();
  if (trimmed === rootHeader || trimmed.startsWith(nestedPrefix)) {
    skip = true;
    return false;
  }
  if (skip && trimmed.startsWith("[") && !trimmed.startsWith(nestedPrefix)) {
    skip = false;
  }
  return !skip;
});

fs.writeFileSync(outputPath, `${kept.join("\n").replace(/\n{3,}/g, "\n\n")}\n`);
EOF

  mv "$tmp_file" "$CODEX_CONFIG_PATH"
  echo "Removed Codex MCP server '$CODEX_SERVER_NAME' from $CODEX_CONFIG_PATH"
}

remove_cursor_server() {
  if [[ ! -f "$CURSOR_CONFIG_PATH" ]]; then
    echo "Cursor config not found, skipping: $CURSOR_CONFIG_PATH"
    return
  fi

  if ! node --input-type=module - "$CURSOR_CONFIG_PATH" "$CURSOR_SERVER_NAME" <<'EOF'
import fs from "node:fs";
const [, , configPath, serverName] = process.argv;
const raw = fs.readFileSync(configPath, "utf8").trim();
if (!raw) process.exit(1);
const data = JSON.parse(raw);
if (!data?.mcpServers || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers)) process.exit(1);
if (!(serverName in data.mcpServers)) process.exit(1);
EOF
  then
    echo "No Cursor MCP server named '$CURSOR_SERVER_NAME' found in $CURSOR_CONFIG_PATH"
    return
  fi

  backup_file "$CURSOR_CONFIG_PATH" >/dev/null

  node --input-type=module - "$CURSOR_CONFIG_PATH" "$CURSOR_SERVER_NAME" <<'EOF'
import fs from "node:fs";

const [, , configPath, serverName] = process.argv;
const raw = fs.readFileSync(configPath, "utf8").trim();
const data = raw ? JSON.parse(raw) : { mcpServers: {} };
delete data.mcpServers[serverName];
fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`);
EOF

  echo "Removed Cursor MCP server '$CURSOR_SERVER_NAME' from $CURSOR_CONFIG_PATH"
}

backup_claude_files() {
  local backed_up=0
  local candidate
  for candidate in "${CLAUDE_BACKUP_CANDIDATES[@]}"; do
    if backup_file "$candidate"; then
      backed_up=1
    fi
  done
  return "$backed_up"
}

remove_claude_server() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "Claude CLI not found, skipping Claude MCP removal."
    return
  fi

  if ! claude mcp get "$CLAUDE_SERVER_NAME" >/dev/null 2>&1; then
    echo "No Claude MCP server named '$CLAUDE_SERVER_NAME' found."
    return
  fi

  backup_claude_files || true

  if claude mcp remove --scope "$CLAUDE_SCOPE" "$CLAUDE_SERVER_NAME"; then
    echo "Removed Claude MCP server '$CLAUDE_SERVER_NAME' from scope '$CLAUDE_SCOPE'."
  else
    echo "Claude MCP removal failed for '$CLAUDE_SERVER_NAME' in scope '$CLAUDE_SCOPE'." >&2
    return 1
  fi
}

echo "This helper can remove local ai-memory agent config."
echo "It will not touch the Supabase database, deployed edge functions, secrets, or .env files."
echo "Before removing any agent config, it creates a timestamped backup of the relevant config file when available."
echo

if confirm "Remove ai-memory config from Codex?"; then
  remove_codex_server
else
  echo "Skipped Codex config."
fi

echo

if confirm "Remove ai-memory config from Cursor in this workspace?"; then
  remove_cursor_server
else
  echo "Skipped Cursor config."
fi

echo

if confirm "Remove ai-memory config from Claude?"; then
  remove_claude_server
else
  echo "Skipped Claude config."
fi

echo
echo "Local uninstall complete."
