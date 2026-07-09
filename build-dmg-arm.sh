#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-dmg-arm.sh — MaskBase build for Apple Silicon Macs (aarch64)
#
# Usage:
#   ./build-dmg-arm.sh          # build only (fast, no signing)
#   ./build-dmg-arm.sh --sign   # build + codesign + notarize
#
# ⚠️  Must be run on an Apple Silicon Mac (M1/M2/M3/M4).
#     Cross-compiling the Python backend from x86_64 → aarch64 is not supported.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SIGN_APP=false
if [[ "${1:-}" == "--sign" ]]; then
  SIGN_APP=true
fi

TARGET="aarch64-apple-darwin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║   MaskBase — DMG Builder (Apple Silicon / ARM64)  ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "▸ Target arch : $TARGET"
if $SIGN_APP; then
  echo "▸ Mode        : BUILD + SIGN + NOTARIZE"
else
  echo "▸ Mode        : BUILD ONLY (use --sign to codesign & notarize)"
fi

# ── 1. Verify we are on an arm64 machine ─────────────────────────────────────
CURRENT_ARCH=$(uname -m)
if [[ "$CURRENT_ARCH" != "arm64" ]]; then
  echo ""
  echo "❌  This script must run on an Apple Silicon Mac (arm64)."
  echo "    Current arch: $CURRENT_ARCH"
  echo "    PyInstaller cannot cross-compile the Python backend to aarch64 from x86_64."
  exit 1
fi

# ── 2. Verify Rust has the required target ────────────────────────────────────
if ! rustup target list --installed 2>/dev/null | grep -q "$TARGET"; then
  echo "▸ Installing Rust target: $TARGET"
  rustup target add "$TARGET"
fi
echo "▸ Rust target : $TARGET ✓"

# ── 3. Activate the Python virtual environment ───────────────────────────────
VENV_PYTHON=""

if [[ -f "$PROJECT_ROOT/.venv/bin/python" ]]; then
  source "$PROJECT_ROOT/.venv/bin/activate"
  VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python"
  echo "▸ Python venv : $VENV_PYTHON"
elif command -v python3 &>/dev/null; then
  VENV_PYTHON="$(command -v python3)"
  echo "▸ Python      : $VENV_PYTHON (system)"
else
  echo "❌  Python not found. Create a venv first:"
  echo "    python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi

PYTHON_VERSION=$("$VENV_PYTHON" --version 2>&1)
echo "▸ Python ver  : $PYTHON_VERSION"

# ── 4. Install PyInstaller if needed ─────────────────────────────────────────
echo ""
echo "── Step 1: Ensuring PyInstaller is installed ───────────────────────────"
"$VENV_PYTHON" -m pip install pyinstaller --quiet --upgrade

# ── 5. Build the Python backend binary ───────────────────────────────────────
echo ""
echo "── Step 2: Building Python backend with PyInstaller ────────────────────"
echo "   (This may take 2–5 minutes on first run)"
echo ""

"$VENV_PYTHON" -m PyInstaller --clean --noconfirm backend.spec

BACKEND_BIN="$PROJECT_ROOT/dist/backend"

if [[ ! -f "$BACKEND_BIN" ]]; then
  echo "❌  PyInstaller did not produce dist/backend"
  echo "    Check the output above for errors."
  exit 1
fi

echo ""
echo "✓  Backend binary built: $BACKEND_BIN"
echo "   Size: $(du -sh "$BACKEND_BIN" | cut -f1)"

# ── 6. Copy binary to src-tauri/binaries/ with Tauri naming convention ───────
echo ""
echo "── Step 3: Installing binary as Tauri sidecar ──────────────────────────"

BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

SIDECAR_PATH="$BINARIES_DIR/backend-${TARGET}"
cp "$BACKEND_BIN" "$SIDECAR_PATH"
chmod +x "$SIDECAR_PATH"

echo "✓  Sidecar placed at: src-tauri/binaries/backend-${TARGET}"

# ── 7. Install npm dependencies (if needed) ───────────────────────────────────
echo ""
echo "── Step 4: Installing npm dependencies ─────────────────────────────────"
npm install --silent

# ── 8. Configure Apple Developer ID signing (if --sign) ──────────────────────
if $SIGN_APP; then
  echo ""
  echo "── Step 5: Configuring Apple Developer ID signing ───────────────────"

  P12_PATH="$PROJECT_ROOT/maskbase_dev.p12"
  SIGNING_ENV="$PROJECT_ROOT/.env.signing"

  if [[ -f "$P12_PATH" ]]; then
    export APPLE_CERTIFICATE
    APPLE_CERTIFICATE=$(base64 -i "$P12_PATH")
    echo "▸ Certificate  : maskbase_dev.p12 ✓"
  else
    echo "❌  No .p12 found at $P12_PATH"; exit 1
  fi

  if [[ -f "$SIGNING_ENV" ]]; then
    set -a
    source "$SIGNING_ENV"
    set +a
    echo "▸ Signing env  : .env.signing ✓"
    [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]] && echo "▸ Identity     : $APPLE_SIGNING_IDENTITY"
    [[ -n "${APPLE_TEAM_ID:-}" ]]          && echo "▸ Team ID      : $APPLE_TEAM_ID"
    [[ -n "${APPLE_ID:-}" ]]               && echo "▸ Notarization : enabled (Apple ID: $APPLE_ID)"
  else
    echo "❌  No .env.signing found — required for --sign"; exit 1
  fi

  echo ""
  echo "── Step 6: Pre-signing backend sidecar (hardened runtime) ─────────────"
  ENTITLEMENTS="$PROJECT_ROOT/src-tauri/entitlements.plist"
  codesign --force --options runtime --timestamp \
    --sign "$APPLE_SIGNING_IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    "$SIDECAR_PATH"
  echo "✓  Sidecar signed with hardened runtime"
else
  echo ""
  echo "── Step 5: Skipping code signing (pass --sign to enable) ────────────"
fi

# ── 9. Build the Tauri app (.dmg) ────────────────────────────────────────────
echo ""
echo "── Step 6: Building Tauri app (Rust compile + bundle) ──────────────────"
echo "   (First build may take 5–10 minutes)"
echo ""

env -u CI npm run tauri build -- --target "$TARGET"

# ── 10. Report output ────────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║                 Build Complete ✓                   ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

DMG_PATH=$(find "$PROJECT_ROOT/src-tauri/target/${TARGET}/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)
if [[ -n "$DMG_PATH" ]]; then
  echo "📦  Apple Silicon DMG ready:"
  echo "    $DMG_PATH"
  echo "    Size: $(du -sh "$DMG_PATH" | cut -f1)"
  echo ""
  echo "    Share this file with Apple Silicon Mac users — no Python or dependencies needed."
else
  echo "⚠️  DMG not found in expected location."
  echo "   Check: src-tauri/target/${TARGET}/release/bundle/"
fi
echo ""
