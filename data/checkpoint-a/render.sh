#!/usr/bin/env bash
# Renders every src/*.html to <id>.pdf next to this script using headless chromium.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
browser="${CHROMIUM_BIN:-chromium}"

shopt -s nullglob
sources=("$dir"/src/*.html)
if [ ${#sources[@]} -eq 0 ]; then
  echo "no sources found in $dir/src" >&2
  exit 1
fi

for src in "${sources[@]}"; do
  id="$(basename "$src" .html)"
  out="$dir/$id.pdf"
  "$browser" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
    --print-to-pdf="$out" "file://$src" >/dev/null 2>&1
  echo "rendered $id.pdf"
done
