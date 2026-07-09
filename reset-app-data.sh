#!/usr/bin/env bash
# reset-app-data.sh — Wipe all MaskBase local data (API keys, chats, sessions)
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       MaskBase — Reset App Data              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 1. Kill any running MaskBase / backend processes
echo "▸ Stopping MaskBase processes..."
pkill -f "maskbase" 2>/dev/null && echo "  ✓ Killed maskbase" || echo "  – maskbase not running"
pkill -f "zeropass" 2>/dev/null && echo "  ✓ Killed legacy zeropass" || true
pkill -f "backend"  2>/dev/null && echo "  ✓ Killed backend"  || echo "  – backend not running"
sleep 1

# 2. Delete ~/.maskbase (API keys, chats, sessions, PII settings, AI model)
if [[ -d "$HOME/.maskbase" ]]; then
  rm -rf "$HOME/.maskbase"
  echo "▸ Deleted ~/.maskbase ✓"
else
  echo "▸ ~/.maskbase not found, skipping"
fi

# Legacy pre-rename data
if [[ -d "$HOME/.zeropass" ]]; then
  rm -rf "$HOME/.zeropass"
  echo "▸ Deleted legacy ~/.zeropass ✓"
fi

# 3. Clear Tauri WebView storage (localStorage)
WEBKIT_DIR="$HOME/Library/WebKit/com.maskbase.app"
SUPPORT_DIR="$HOME/Library/Application Support/com.maskbase.app"
LEGACY_WEBKIT="$HOME/Library/WebKit/com.zeropass.app"
LEGACY_SUPPORT="$HOME/Library/Application Support/com.zeropass.app"

if [[ -d "$WEBKIT_DIR" ]]; then
  rm -rf "$WEBKIT_DIR"
  echo "▸ Cleared WebKit storage ✓"
fi

if [[ -d "$SUPPORT_DIR" ]]; then
  rm -rf "$SUPPORT_DIR"
  echo "▸ Cleared Application Support storage ✓"
fi

if [[ -d "$LEGACY_WEBKIT" ]]; then
  rm -rf "$LEGACY_WEBKIT"
  echo "▸ Cleared legacy WebKit storage ✓"
fi

if [[ -d "$LEGACY_SUPPORT" ]]; then
  rm -rf "$LEGACY_SUPPORT"
  echo "▸ Cleared legacy Application Support storage ✓"
fi

echo ""
echo "✓  All MaskBase data has been cleared."
echo "   You can now relaunch the app fresh."
echo ""
