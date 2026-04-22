#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${ANTIGRAVITY_CLI_REPO_URL:-https://github.com/professional-ALFIE/antigravity-cli.git}"
INSTALL_ROOT="${ANTIGRAVITY_CLI_HOME:-$HOME/.antigravity-cli}"
SOURCE_DIR="${ANTIGRAVITY_CLI_SOURCE_DIR:-$INSTALL_ROOT/source}"
BIN_DIR="${ANTIGRAVITY_CLI_BIN_DIR:-$HOME/.local/bin}"
ENTRYPOINT_RELATIVE_PATH="src/entrypoints/cli.ts"
LOCAL_ENV_FILE_NAME=".env.local"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] Missing required command: $1" >&2
    exit 1
  fi
}

resolve_antigravity_app_path() {
  local candidates=()

  if [ -n "${ANTIGRAVITY_APP_PATH:-}" ]; then
    candidates+=("$ANTIGRAVITY_APP_PATH")
  fi

  candidates+=(
    "/Applications/Antigravity.app"
    "$HOME/Applications/Antigravity.app"
    "/Applications/Antigravity-2.app"
    "$HOME/Applications/Antigravity-2.app"
    "$HOME/Applications/Antigravity-2/Antigravity-2.app"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

extract_oauth_pair_from_app() {
  local app_path="$1"
  local main_js="$app_path/Contents/Resources/app/out/main.js"
  local ls_bin="$app_path/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm"
  local client_id=""
  local client_secret=""

  if [ -f "$main_js" ]; then
    client_id="$(LC_ALL=C grep -Eao '[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com' "$main_js" | head -n 1 || true)"
    client_secret="$(LC_ALL=C grep -Eao 'GOCSPX-[A-Za-z0-9_-]+' "$main_js" | head -n 1 || true)"
  fi

  if { [ -z "$client_id" ] || [ -z "$client_secret" ]; } && [ -f "$ls_bin" ]; then
    if [ -z "$client_id" ]; then
      client_id="$(strings -a "$ls_bin" 2>/dev/null | LC_ALL=C grep -Eo '[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com' | head -n 1 || true)"
    fi
    if [ -z "$client_secret" ]; then
      client_secret="$(strings -a "$ls_bin" 2>/dev/null | LC_ALL=C grep -Eo 'GOCSPX-[A-Za-z0-9_-]+' | head -n 1 || true)"
    fi
  fi

  if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
    return 1
  fi

  printf '%s\n%s\n' "$client_id" "$client_secret"
}

ensure_local_oauth_env() {
  local source_dir="$1"
  local env_file="$source_dir/$LOCAL_ENV_FILE_NAME"
  local has_client_id="false"
  local has_client_secret="false"

  if [ -f "$env_file" ]; then
    if grep -q '^ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID=' "$env_file"; then
      has_client_id="true"
    fi
    if grep -q '^ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET=' "$env_file"; then
      has_client_secret="true"
    fi
  fi

  if [ "$has_client_id" = "true" ] && [ "$has_client_secret" = "true" ]; then
    echo "[3/6] Keeping existing $LOCAL_ENV_FILE_NAME OAuth config..."
    return 0
  fi

  local app_path=""
  app_path="$(resolve_antigravity_app_path || true)"
  if [ -z "$app_path" ]; then
    echo "[3/6] Antigravity app not found; skipping OAuth autofill."
    return 0
  fi

  local extracted_var=""
  extracted_var="$(extract_oauth_pair_from_app "$app_path" || true)"
  if [ -z "$extracted_var" ]; then
    echo "[3/6] Could not extract OAuth client config from $app_path; skipping autofill."
    return 0
  fi

  local client_id=""
  local client_secret=""
  client_id="$(printf '%s\n' "$extracted_var" | sed -n '1p')"
  client_secret="$(printf '%s\n' "$extracted_var" | sed -n '2p')"

  touch "$env_file"
  chmod 600 "$env_file"

  if [ "$has_client_id" != "true" ]; then
    printf 'ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_ID=%s\n' "$client_id" >> "$env_file"
  fi
  if [ "$has_client_secret" != "true" ]; then
    printf 'ANTIGRAVITY_GOOGLE_OAUTH_CLIENT_SECRET=%s\n' "$client_secret" >> "$env_file"
  fi

  echo "[3/6] Wrote local OAuth config to $LOCAL_ENV_FILE_NAME from $app_path"
}

echo "[1/6] Checking prerequisites..."
require_cmd git
require_cmd bun

mkdir -p "$INSTALL_ROOT"

if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[2/6] Updating existing source checkout..."
  git -C "$SOURCE_DIR" remote set-url origin "$REPO_URL"
  git -C "$SOURCE_DIR" fetch --tags origin
  git -C "$SOURCE_DIR" checkout -B main origin/main
  git -C "$SOURCE_DIR" reset --hard origin/main
  git -C "$SOURCE_DIR" clean -fd
else
  echo "[2/6] Cloning source..."
  rm -rf "$SOURCE_DIR"
  git clone "$REPO_URL" "$SOURCE_DIR"
fi

ensure_local_oauth_env "$SOURCE_DIR"

echo "[4/6] Installing dependencies..."
cd "$SOURCE_DIR"
bun install --frozen-lockfile || bun install

echo "[5/6] Preparing executable entrypoints..."
chmod +x "$SOURCE_DIR/src/main.ts" "$SOURCE_DIR/$ENTRYPOINT_RELATIVE_PATH"
mkdir -p "$BIN_DIR"
ln -sf "$SOURCE_DIR/$ENTRYPOINT_RELATIVE_PATH" "$BIN_DIR/antigravity-cli"
ln -sf "$SOURCE_DIR/$ENTRYPOINT_RELATIVE_PATH" "$BIN_DIR/agcl"

echo "[6/6] Verifying installation..."
"$BIN_DIR/antigravity-cli" --help >/dev/null

echo
echo "Installed antigravity-cli (alias: agcl)"
echo "  source: $SOURCE_DIR"
echo "  binary: $BIN_DIR/antigravity-cli"
echo "  alias:  $BIN_DIR/agcl"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "  PATH: ok"
    ;;
  *)
    echo
    echo "Add this to your shell profile if needed:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
