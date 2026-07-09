#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-dmg-intel.sh — MaskBase build for Intel Macs (x86_64)
#
# Works on both Intel Macs and Apple Silicon Macs (via Rosetta 2).
#
# Usage:
#   ./build-dmg-intel.sh          # build only (fast, no signing)
#   ./build-dmg-intel.sh --sign   # build + codesign + notarize
#
# If running on Apple Silicon for the first time, this script will guide you
# through installing the x86_64 Python needed for cross-compilation.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SIGN_APP=false
if [[ "${1:-}" == "--sign" ]]; then
  SIGN_APP=true
fi

TARGET="x86_64-apple-darwin"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   MaskBase — DMG Builder (Intel / x86_64)   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "▸ Target arch : $TARGET"
if $SIGN_APP; then
  echo "▸ Mode        : BUILD + SIGN + NOTARIZE"
else
  echo "▸ Mode        : BUILD ONLY (use --sign to codesign & notarize)"
fi

# ── 1. Detect current machine architecture ───────────────────────────────────
CURRENT_ARCH=$(uname -m)
echo "▸ Machine arch: $CURRENT_ARCH"

# ── 2. If on Apple Silicon, verify Rosetta 2 is available ────────────────────
if [[ "$CURRENT_ARCH" == "arm64" ]]; then
  echo ""
  echo "▸ Apple Silicon detected — will use Rosetta 2 for x86_64 Python build"

  if ! arch -x86_64 true 2>/dev/null; then
    echo ""
    echo "❌  Rosetta 2 is not installed. Install it with:"
    echo "    softwareupdate --install-rosetta --agree-to-license"
    exit 1
  fi
  echo "▸ Rosetta 2    : ✓"
fi

# ── 3. Verify Rust has the x86_64 target ─────────────────────────────────────
if ! rustup target list --installed 2>/dev/null | grep -q "$TARGET"; then
  echo "▸ Installing Rust target: $TARGET"
  rustup target add "$TARGET"
fi
echo "▸ Rust target  : $TARGET ✓"

# ── 4. Find an x86_64 Python ─────────────────────────────────────────────────
echo ""
echo "── Step 1: Locating x86_64 Python ─────────────────────────────────────"

X86_PYTHON=""

# Option A: dedicated x86_64 venv (preferred — fastest repeated builds)
if [[ -f "$PROJECT_ROOT/.venv-x86/bin/python" ]]; then
  # Verify it is actually x86_64
  VENV_ARCH=$(arch -x86_64 "$PROJECT_ROOT/.venv-x86/bin/python" -c "import platform; print(platform.machine())" 2>/dev/null || echo "unknown")
  if [[ "$VENV_ARCH" == "x86_64" ]]; then
    X86_PYTHON="$PROJECT_ROOT/.venv-x86/bin/python"
    echo "▸ Found x86_64 venv : .venv-x86"
  fi
fi

# Option B: Intel Homebrew Python at /usr/local/bin/python3
if [[ -z "$X86_PYTHON" ]] && [[ -f "/usr/local/bin/python3" ]]; then
  BREW_ARCH=$(/usr/local/bin/python3 -c "import platform; print(platform.machine())" 2>/dev/null || echo "unknown")
  if [[ "$BREW_ARCH" == "x86_64" ]]; then
    X86_PYTHON="/usr/local/bin/python3"
    echo "▸ Found x86_64 Python : /usr/local/bin/python3 (Intel Homebrew)"
  fi
fi

# Option C: No x86_64 Python found — guide the user
if [[ -z "$X86_PYTHON" ]]; then
  echo ""
  echo "❌  No x86_64 Python found."
  echo ""
  echo "    You need an Intel (x86_64) Python to build the Intel backend binary."
  echo "    Run these commands once to set it up:"
  echo ""
  echo "    # 1. Install Intel Homebrew (runs under Rosetta)"
  echo "    arch -x86_64 /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  echo ""
  echo "    # 2. Install Python via Intel Homebrew"
  echo "    arch -x86_64 /usr/local/bin/brew install python"
  echo ""
  echo "    # 3. Create the x86_64 venv for this project"
  echo "    arch -x86_64 /usr/local/bin/python3 -m venv .venv-x86"
  echo "    arch -x86_64 .venv-x86/bin/pip install -r backend/requirements.txt"
  echo ""
  echo "    Then re-run this script."
  exit 1
fi

X86_PYTHON_VERSION=$(arch -x86_64 "$X86_PYTHON" --version 2>&1)
echo "▸ Python ver   : $X86_PYTHON_VERSION"

# ── 5. Install PyInstaller into the x86_64 Python ────────────────────────────
echo ""
echo "── Step 2: Ensuring PyInstaller is installed (x86_64) ─────────────────"
arch -x86_64 "$X86_PYTHON" -m pip install pyinstaller --quiet --upgrade

# ── 6. Build the Python backend binary (x86_64) ──────────────────────────────
echo ""
echo "── Step 3: Building Python backend with PyInstaller (x86_64) ──────────"
echo "   (This may take 2–5 minutes on first run)"
echo ""

arch -x86_64 "$X86_PYTHON" -m PyInstaller --clean --noconfirm backend.spec

BACKEND_BIN="$PROJECT_ROOT/dist/backend"

if [[ ! -f "$BACKEND_BIN" ]]; then
  echo "❌  PyInstaller did not produce dist/backend"
  echo "    Check the output above for errors."
  exit 1
fi

# Verify the binary is actually x86_64
BIN_ARCH=$(file "$BACKEND_BIN" | grep -o 'x86_64\|arm64' | head -1)
if [[ "$BIN_ARCH" != "x86_64" ]]; then
  echo "❌  Backend binary is $BIN_ARCH, expected x86_64."
  echo "    Make sure you are using an x86_64 Python."
  exit 1
fi

echo ""
echo "✓  Backend binary built : $BACKEND_BIN  [$BIN_ARCH]"
echo "   Size: $(du -sh "$BACKEND_BIN" | cut -f1)"

# ── 7. Copy binary to src-tauri/binaries/ with Tauri naming convention ───────
echo ""
echo "── Step 4: Installing binary as Tauri sidecar ──────────────────────────"

BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

SIDECAR_PATH="$BINARIES_DIR/backend-${TARGET}"
cp "$BACKEND_BIN" "$SIDECAR_PATH"
chmod +x "$SIDECAR_PATH"

echo "✓  Sidecar placed at: src-tauri/binaries/backend-${TARGET}"

# ── 8. Install npm dependencies (if needed) ───────────────────────────────────
echo ""
echo "── Step 5: Installing npm dependencies ─────────────────────────────────"
npm install --silent

# ── 9. Configure Apple Developer ID signing (if --sign) ──────────────────────
if $SIGN_APP; then
  echo ""
  echo "── Step 6: Configuring Apple Developer ID signing ───────────────────"

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
  echo "── Step 7: Pre-signing backend sidecar (hardened runtime) ─────────────"
  ENTITLEMENTS="$PROJECT_ROOT/src-tauri/entitlements.plist"
  codesign --force --options runtime --timestamp \
    --sign "$APPLE_SIGNING_IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    "$SIDECAR_PATH"
  echo "✓  Sidecar signed with hardened runtime"
else
  echo ""
  echo "── Step 6: Skipping code signing (pass --sign to enable) ────────────"
fi

# ── 10. Build the Tauri app (.dmg) for x86_64 ────────────────────────────────
echo ""
echo "── Step 8: Building Tauri app (Rust compile + bundle) ──────────────────"
echo "   (First build may take 5–10 minutes)"
echo ""

env -u CI npm run tauri build -- --target "$TARGET"

# ── 11. Report output ─────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║              Build Complete ✓                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

DMG_PATH=$(find "$PROJECT_ROOT/src-tauri/target/${TARGET}/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)
if [[ -n "$DMG_PATH" ]]; then
  echo "📦  Intel DMG ready:"
  echo "    $DMG_PATH"
  echo "    Size: $(du -sh "$DMG_PATH" | cut -f1)"
  echo ""
  echo "    Share this file with Intel Mac users — no Python or dependencies needed."
else
  echo "⚠️  DMG not found in expected location."
  echo "   Check: src-tauri/target/${TARGET}/release/bundle/"
fi
echo ""
