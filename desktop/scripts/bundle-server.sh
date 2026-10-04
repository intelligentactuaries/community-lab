#!/usr/bin/env bash
# Bundle Community Lab's server and client into desktop/resources/server/, which
# electron-builder ships inside the installer and the main process starts with
# the app (desktop/src/server.ts):
#
#   resources/server/community-lab-server[.exe]  `bun build --compile` of the Bun server, with the engine's
#                                                worker (src/server/worker.ts) compiled in as a second entry
#   resources/server/ui/                         the Vite-built client, served by that server on its own origin
#   resources/server/manifest.json               target, bun version, sizes, commit, built_at
#
# One target per run: TARGET_OS=linux|mac|win, from `uname` when unset. Bun
# cross-compiles, so any host can build any target. Idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
OUT_DIR="$DESKTOP_DIR/resources/server"

TARGET_OS="${TARGET_OS:-}"
if [ -z "$TARGET_OS" ]; then
  case "$(uname -s)" in
    Linux*)  TARGET_OS=linux ;;
    Darwin*) TARGET_OS=mac ;;
    MINGW*|MSYS*|CYGWIN*) TARGET_OS=win ;;
    *) echo "Unknown OS: $(uname -s)"; exit 1 ;;
  esac
fi

case "$TARGET_OS" in
  linux) BUN_TARGET="bun-linux-x64";    BIN_NAME="community-lab-server" ;;
  mac)   BUN_TARGET="bun-darwin-arm64"; BIN_NAME="community-lab-server" ;;
  win)   BUN_TARGET="bun-windows-x64";  BIN_NAME="community-lab-server.exe" ;;
  *) echo "Unknown TARGET_OS: $TARGET_OS"; exit 1 ;;
esac

command -v bun >/dev/null 2>&1 || { echo "bun is required (https://bun.sh)"; exit 1; }

echo "▷ Bundling Community Lab's server for $TARGET_OS ($BUN_TARGET)"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ─── 1. Client (Vite) ──────────────────────────────────────────────────
echo "  ↓ Building the client (vite)"
(cd "$REPO_ROOT" && bun run build >/dev/null)
cp -R "$REPO_ROOT/dist" "$OUT_DIR/ui"
# Source maps are for development; the installer does not need them.
find "$OUT_DIR/ui" -name '*.map' -delete
echo "  ✓ Client at $OUT_DIR/ui ($(du -sh "$OUT_DIR/ui" | cut -f1))"

# ─── 2. Server (a single executable) ───────────────────────────────────
echo "  ↓ Compiling the server ($BUN_TARGET)"
(cd "$REPO_ROOT" && bun build --compile --minify --target="$BUN_TARGET" \
  src/server/index.ts src/server/worker.ts --outfile "$OUT_DIR/$BIN_NAME" >/dev/null)
chmod +x "$OUT_DIR/$BIN_NAME" 2>/dev/null || true
echo "  ✓ Server at $OUT_DIR/$BIN_NAME ($(du -h "$OUT_DIR/$BIN_NAME" | cut -f1))"

# ─── 3. Manifest ────────────────────────────────────────────────────────
bin_size=$(du -sk "$OUT_DIR/$BIN_NAME" | awk '{print $1 * 1024}')
ui_size=$(du -sk "$OUT_DIR/ui" | awk '{print $1 * 1024}')
commit=$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)
cat > "$OUT_DIR/manifest.json" <<JSON
{
  "target_os": "$TARGET_OS",
  "bun_target": "$BUN_TARGET",
  "bun_version": "$(bun --version)",
  "commit": "$commit",
  "server": { "file": "$BIN_NAME", "bytes": $bin_size },
  "ui": { "dir": "ui", "bytes": $ui_size },
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "▷ Server bundle ready: $OUT_DIR"
