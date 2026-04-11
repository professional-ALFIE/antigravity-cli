#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${ANTIGRAVITY_CLI_REPO_URL:-https://github.com/professional-ALFIE/antigravity-cli.git}"
INSTALL_ROOT="${ANTIGRAVITY_CLI_HOME:-$HOME/.antigravity-cli}"
SOURCE_DIR="${ANTIGRAVITY_CLI_SOURCE_DIR:-$INSTALL_ROOT/source}"
BIN_DIR="${ANTIGRAVITY_CLI_BIN_DIR:-$HOME/.local/bin}"
ENTRYPOINT_RELATIVE_PATH="src/entrypoints/cli.ts"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] Missing required command: $1" >&2
    exit 1
  fi
}

reset_existing_checkout_to_origin_main() {
  echo "[warn] Existing source checkout diverged from origin/main. Resetting installer cache to match the remote..."
  git -C "$SOURCE_DIR" fetch --tags origin
  git -C "$SOURCE_DIR" checkout -B main origin/main
  git -C "$SOURCE_DIR" reset --hard origin/main
  git -C "$SOURCE_DIR" clean -fd
}

echo "[1/5] Checking prerequisites..."
require_cmd git
require_cmd bun

mkdir -p "$INSTALL_ROOT"

if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[2/5] Updating existing source checkout..."
  git -C "$SOURCE_DIR" remote set-url origin "$REPO_URL"
  git -C "$SOURCE_DIR" fetch --tags origin
  git -C "$SOURCE_DIR" checkout main >/dev/null 2>&1 || git -C "$SOURCE_DIR" checkout -B main origin/main
  if ! git -C "$SOURCE_DIR" pull --ff-only origin main; then
    reset_existing_checkout_to_origin_main
  fi
else
  echo "[2/5] Cloning source..."
  rm -rf "$SOURCE_DIR"
  git clone "$REPO_URL" "$SOURCE_DIR"
fi

echo "[3/5] Installing dependencies..."
cd "$SOURCE_DIR"
bun install --frozen-lockfile || bun install

echo "[4/5] Preparing executable entrypoints..."
chmod +x "$SOURCE_DIR/src/main.ts" "$SOURCE_DIR/$ENTRYPOINT_RELATIVE_PATH"
mkdir -p "$BIN_DIR"
ln -sf "$SOURCE_DIR/$ENTRYPOINT_RELATIVE_PATH" "$BIN_DIR/antigravity-cli"
ln -sf "$SOURCE_DIR/$ENTRYPOINT_RELATIVE_PATH" "$BIN_DIR/agcl"

echo "[5/5] Verifying installation..."
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
