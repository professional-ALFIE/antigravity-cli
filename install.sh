#!/usr/bin/env bash
#
# antigravity-cli installer
# curl -sL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
#
set -euo pipefail

# ─── 색상 ─────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "  ${CYAN}▸${NC} $1"; }
success() { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; exit 1; }

REPO_URL="https://github.com/professional-ALFIE/antigravity-cli.git"
DATA_DIR="$HOME/.antigravity-cli"
INSTALL_DIR="$DATA_DIR/source"
BIN_DIR="$HOME/.local/bin"

echo ""
echo -e "  ${BOLD}antigravity-cli installer${NC}"
echo -e "  ${DIM}Antigravity IDE를 외부에서 제어하는 헤드리스 CLI${NC}"
echo ""

# ─── 1. 사전 요구사항 ──────────────────────────────────
info "사전 요구사항 확인 중..."

command -v git  >/dev/null 2>&1 || fail "git이 필요합니다. https://git-scm.com"
command -v node >/dev/null 2>&1 || fail "Node.js 18+가 필요합니다. https://nodejs.org"
command -v npm  >/dev/null 2>&1 || fail "npm이 필요합니다."

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 18 ] 2>/dev/null || fail "Node.js 18 이상이 필요합니다. (현재: $(node -v))"

HAS_BUN=false
if command -v bun >/dev/null 2>&1; then
  HAS_BUN=true
  success "bun 감지 — CLI를 bun으로 실행합니다 (가장 빠름)"
else
  warn "bun 미설치 — node + tsx로 실행합니다 (정상 동작, 약간 느림)"
  echo -e "    ${DIM}더 빠른 실행: curl -fsSL https://bun.sh/install | bash${NC}"
fi

success "사전 요구사항 확인 완료"

# ─── 2. 소스 다운로드 ──────────────────────────────────
echo ""
mkdir -p "$DATA_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  info "기존 설치를 업데이트합니다..."
  cd "$INSTALL_DIR"
  git fetch origin
  git reset --hard origin/main
else
  info "저장소를 다운로드합니다..."
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
success "소스 다운로드 완료"

# ─── 3. 의존성 설치 ────────────────────────────────────
info "의존성 설치 중... (처음이면 1~2분 소요)"
npm install --no-audit --no-fund --loglevel=error 2>&1 | tail -3
success "의존성 설치 완료"

# ─── 4. SDK 빌드 ──────────────────────────────────────
info "SDK 빌드 중..."
npm -w packages/sdk run build --silent 2>&1 | tail -1
success "SDK 빌드 완료"

# ─── 5. Extension 빌드 + 패키징 ───────────────────────
info "Bridge Extension 빌드 중..."
npm -w packages/extension run build --silent 2>&1 | tail -1
success "Extension 빌드 완료"

info "Extension 패키징 중 (.vsix)..."
cd "$INSTALL_DIR/packages/extension"
(yes 2>/dev/null || true) | npx -y @vscode/vsce package --no-dependencies 2>&1 | tail -1 || true
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)
cd "$INSTALL_DIR"

if [ -z "${VSIX_FILE:-}" ]; then
  warn "Extension .vsix 패키징 실패"
else
  success "Extension 패키징 완료: ${VSIX_FILE}"
fi

# ─── 6. Antigravity IDE에 Extension 설치 ──────────────
echo ""
AG_CLI=""
# macOS
if [ -f "/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity" ]; then
  AG_CLI="/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity"
fi

if [ -n "$AG_CLI" ] && [ -n "${VSIX_FILE:-}" ]; then
  info "Antigravity IDE에 Extension 설치 중..."
  "$AG_CLI" --install-extension "$INSTALL_DIR/packages/extension/$VSIX_FILE" --force 2>&1 | tail -1
  success "Extension 설치 완료"
  echo -e "    ${DIM}IDE를 재시작하면 Bridge가 자동 활성화됩니다${NC}"
else
  warn "Antigravity IDE 자동 설치 불가 — 수동 설치가 필요합니다:"
  echo -e "    ${DIM}Antigravity IDE → Cmd+Shift+P → 'Install from VSIX'${NC}"
  echo -e "    ${DIM}파일: $INSTALL_DIR/packages/extension/${VSIX_FILE:-*.vsix}${NC}"
fi

# ─── 7. CLI 래퍼 생성 ─────────────────────────────────
echo ""
info "CLI 설정 중..."
mkdir -p "$BIN_DIR"

if [ "$HAS_BUN" = true ]; then
  cat > "$BIN_DIR/antigravity-cli" << 'EOF'
#!/usr/bin/env bash
exec bun "$HOME/.antigravity-cli/source/packages/cli/bin/antigravity-cli.ts" "$@"
EOF
else
  # tsx는 npm install 시 packages/cli 하위에 설치됨
  cat > "$BIN_DIR/antigravity-cli" << 'NODEEOF'
#!/usr/bin/env bash
DIR="$HOME/.antigravity-cli/source"
# tsx 바이너리 탐색: 루트 hoisting → cli 로컬
TSX="$DIR/node_modules/.bin/tsx"
[ -x "$TSX" ] || TSX="$DIR/packages/cli/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "오류: tsx를 찾을 수 없습니다. cd $DIR && npm install 을 실행하세요."; exit 1; }
exec "$TSX" "$DIR/packages/cli/bin/antigravity-cli.ts" "$@"
NODEEOF
fi

chmod +x "$BIN_DIR/antigravity-cli"
success "CLI 설치 완료: $BIN_DIR/antigravity-cli"

# ─── 8. PATH 확인 ─────────────────────────────────────
PATH_OK=false
if echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR" 2>/dev/null; then
  PATH_OK=true
fi

if [ "$PATH_OK" = false ]; then
  echo ""
  warn "PATH에 $BIN_DIR 이 없습니다. 아래를 실행하세요:"
  echo ""
  SHELL_RC=""
  case "$(basename "$SHELL")" in
    zsh)  SHELL_RC="~/.zshrc" ;;
    bash) SHELL_RC="~/.bashrc" ;;
    fish) SHELL_RC="~/.config/fish/config.fish" ;;
    *)    SHELL_RC="~/.profile" ;;
  esac
  echo -e "    ${CYAN}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ${SHELL_RC}${NC}"
  echo -e "    ${CYAN}source ${SHELL_RC}${NC}"
fi

# ─── 완료 ─────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}✓ 설치 완료!${NC}"
echo ""
echo -e "  ${BOLD}사용법:${NC}"
echo -e "    ${CYAN}antigravity-cli --help${NC}                도움말"
echo -e "    ${CYAN}antigravity-cli \"코드 리뷰해줘\"${NC}       새 대화 생성"
echo -e "    ${CYAN}antigravity-cli server status${NC}          서버 상태 확인"
echo -e "    ${CYAN}antigravity-cli -r${NC}                     대화 목록"
echo ""
echo -e "  ${BOLD}업데이트:${NC}"
echo -e "    ${DIM}같은 명령을 다시 실행하면 자동 업데이트됩니다${NC}"
echo ""
