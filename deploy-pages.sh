#!/usr/bin/env bash
# Builds the static version and publishes it to the gh-pages branch (GitHub Pages).
# The previous single-file app is kept at /anterior/ (same origin, so its saved data stays reachable).
set -euo pipefail
cd "$(dirname "$0")"
rm -rf out
STATIC_EXPORT=1 npx next build
mkdir -p out/anterior && cp index.html out/anterior/index.html
touch out/.nojekyll
tmp=$(mktemp -d)
git worktree add -f "$tmp" gh-pages 2>/dev/null || git worktree add -f --orphan -b gh-pages "$tmp"
# keep the old _next/static files: phones that still have the previous page cached ask for them
find "$tmp" -mindepth 1 -maxdepth 1 ! -name .git ! -name _next -exec rm -rf {} +
cp -a out/. "$tmp"/
git -C "$tmp" add -A
# sanity check: every page must point to scripts that are being published
for f in "$tmp"/index.html "$tmp"/bolsos/index.html; do
  for js in $(grep -o '/_next/static/chunks/[^"]*\.js' "$f" | sort -u); do
    [ -f "$tmp${js#/mi-bolso}" ] || [ -f "$tmp/${js#*/_next/../}" ] || [ -f "$tmp/_next/${js#*/_next/}" ] || { echo "FALTA $js en $f"; exit 1; }
  done
done
cmp -s out/bolsos/index.html "$tmp"/bolsos/index.html || { echo "bolsos/index.html no se copió"; exit 1; }
git -C "$tmp" commit -qm "Publicar $(git rev-parse --short HEAD)" || echo "sin cambios"
git -C "$tmp" push origin gh-pages
git worktree remove --force "$tmp"
