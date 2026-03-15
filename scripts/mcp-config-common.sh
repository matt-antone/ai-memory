#!/usr/bin/env bash

set -euo pipefail

timestamp="$(date +"%Y%m%d-%H%M%S")"

confirm() {
  local prompt="$1"
  local default_answer="${2:-N}"
  local suffix="[y/N]"
  if [[ "$default_answer" == "Y" ]]; then
    suffix="[Y/n]"
  fi

  local answer
  read -r -p "$prompt $suffix " answer
  answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"

  if [[ -z "$answer" ]]; then
    [[ "$default_answer" == "Y" ]]
    return
  fi

  case "$answer" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

prompt_choice() {
  local prompt="$1"
  local default_index="$2"
  shift 2
  local options=("$@")

  echo "$prompt" >&2
  local i=1
  for option in "${options[@]}"; do
    echo "  $i) $option" >&2
    i=$((i + 1))
  done

  local answer
  while true; do
    read -r -p "Choose an option [$default_index]: " answer
    answer="${answer:-$default_index}"
    if [[ "$answer" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= ${#options[@]} )); then
      printf '%s\n' "${options[$((answer - 1))]}"
      return 0
    fi
    echo "Enter a number between 1 and ${#options[@]}." >&2
  done
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
}

ensure_parent_dir() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
}

choose_install_scope() {
  local agent="$1"
  prompt_choice "Where should $agent store the ai-memory config?" 1 "project/local" "global/user"
}

choose_conflict_mode() {
  local agent="$1"
  local scope="$2"
  local path="$3"
  local managed_label="$4"

  echo "Found an existing ai-memory registration for $agent in $scope:" >&2
  echo "  $path" >&2
  if [[ "$managed_label" == "managed" ]]; then
    echo "The existing registration looks like it was created by this repo." >&2
  else
    echo "The existing registration appears unmanaged." >&2
    echo "Overwrite will take control of that entry." >&2
  fi

  prompt_choice "How should the existing registration be handled?" 1 "merge" "overwrite"
}

detect_shell_rc_file() {
  local shell_name
  shell_name="$(basename "${SHELL:-}")"

  case "$shell_name" in
    zsh) printf '%s\n' "$HOME/.zshrc" ;;
    bash) printf '%s\n' "$HOME/.bashrc" ;;
    fish) printf '%s\n' "$HOME/.config/fish/config.fish" ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

print_global_env_instructions() {
  local rc_file
  local green=$'\033[0;32m'
  local bold_green=$'\033[1;32m'
  local reset=$'\033[0m'
  rc_file="$(detect_shell_rc_file)"

  printf '\n'
  printf '%s%s%s\n' "$bold_green" "============================================================" "$reset"
  printf '%s%s%s\n' "$bold_green" "  PERMANENT GLOBAL AI-MEMORY ENV SETUP" "$reset"
  printf '%s%s%s\n' "$bold_green" "============================================================" "$reset"
  printf '%s%s %s%s\n' "$green" "Add these vars to:" "$rc_file" "$reset"
  printf '\n'
  if [[ "$rc_file" == *.fish ]]; then
    printf '%s%s%s\n' "$green" "Example:" "$reset"
    printf '%s%s%s\n' "$green" "  set -Ux MEMORY_MCP_ACCESS_KEY \"your-access-key\"" "$reset"
    printf '\n'
    printf '%s%s%s\n' "$green" "Then open a new terminal session before relaunching your MCP host." "$reset"
    return 0
  fi

  printf '%s%s%s\n' "$green" "Example:" "$reset"
  printf '%s%s%s\n' "$green" "  export MEMORY_MCP_ACCESS_KEY=\"your-access-key\"" "$reset"
  printf '\n'
  printf '%s%s%s\n' "$green" "Then reload your shell with:" "$reset"
  printf '%s%s%s\n' "$green" "  source \"$rc_file\"" "$reset"
  printf '%s%s%s\n' "$green" "and relaunch your MCP host." "$reset"
}
