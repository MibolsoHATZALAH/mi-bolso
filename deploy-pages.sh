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
find "$tmp" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a out/. "$tmp"/
git -C "$tmp" add -A
git -C "$tmp" commit -qm "Publicar $(git rev-parse --short HEAD)" || echo "sin cambios"
git -C "$tmp" push origin gh-pages
git worktree remove --force "$tmp"
