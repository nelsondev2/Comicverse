#!/usr/bin/env bash
#
# Comicverse — build the .xdc package
#
#   ./build.sh            → release/comicverse-<version>.xdc
#   VERSION=1.2.0 ./build.sh
#
# The .xdc is a plain ZIP (deflate) that contains index.html, manifest.toml,
# icon.png and the assets/ folder. Development-only folders (dev/, tests/,
# tools/) and webxdc.js (provided by the messenger) are never packaged.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VERSION="$(grep -E '^version[[:space:]]*=' manifest.toml | head -1 | sed -E 's/.*"(.*)".*/\1/')"
OUT_DIR="${OUT_DIR:-release}"
NAME="comicverse${VERSION:+-$VERSION}"
OUT="$OUT_DIR/$NAME.xdc"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.xdc

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# ---- whitelist the runtime files -------------------------------------------
cp index.html manifest.toml icon.png "$STAGE"/
mkdir -p "$STAGE/assets"
cp -r assets/css assets/js assets/vendor "$STAGE/assets/"
if [ -d assets/img ]; then cp -r assets/img "$STAGE/assets/"; fi

# Safety: never ship the simulator or dev sources
rm -f "$STAGE/webxdc.js" "$STAGE"/dev/webxdc.js
find "$STAGE" -name '*.map' -delete

# ---- validate ---------------------------------------------------------------
[ -f "$STAGE/index.html" ] || { echo "missing index.html" >&2; exit 1; }
[ -f "$STAGE/manifest.toml" ] || { echo "missing manifest.toml" >&2; exit 1; }
[ -f "$STAGE/icon.png" ] || { echo "missing icon.png" >&2; exit 1; }

# ---- zip --------------------------------------------------------------------
( cd "$STAGE" && zip -q -9 -X -r "$ROOT/$OUT" . -x '.*' -x '*/.*' )

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✅ $OUT ($SIZE)"
echo "   $(unzip -l "$OUT" | tail -1 | awk '{print $2}') files"
