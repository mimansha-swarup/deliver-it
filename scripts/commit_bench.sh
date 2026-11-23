#!/bin/bash
# Measures commits one after another, each the same way: a brand-new player, 10 s standing at the
# first spawn, then 15 s riding the first order's route (scripts/commit_steps.mjs).
#
#     scripts/commit_bench.sh main b03cc24 8d75fcb ...          # in a normal Chrome window
#     HEADLESS=1 LOCK=1.25 scripts/commit_bench.sh main HEAD    # no window, the render scale held at 1.25
#
# Each commit is checked out into .bisect.local/tree (a git worktree; nothing in your working copy
# is touched), built, served on port 4180 and measured. One line per commit: frames a second
# standing and riding, the worst frame, the render scale, the first four seconds after the loading
# cover, and what a frame costs with the GPU waited for (which no screen's refresh rate hides).
# The window must be on screen: a normal window draws nothing while the screen is locked.
# Results are also written to clips/commit-bench/<commit>.json.
set -u
cd "$(dirname "$0")/.."
ROOT=$PWD
W=$ROOT/.bisect.local
OUT=$ROOT/clips/commit-bench
mkdir -p "$W/dists" "$OUT"
if [ ! -d "$W/tree" ]; then git worktree prune; git worktree add -q --detach "$W/tree" HEAD; ln -s "$ROOT/node_modules" "$W/tree/node_modules"; [ -f .env.local ] && cp .env.local "$W/tree/"; fi
for c in "$@"; do
  sha=$(git rev-parse --short "$c") || continue
  if [ ! -d "$W/dists/$sha" ]; then (cd "$W/tree" && git checkout -q --detach "$sha" && npm run build > /dev/null 2>&1 && cp -R dist "$W/dists/$sha") || { echo "$c: did not build"; continue; }; fi
  (npx vite preview --outDir "$W/dists/$sha" --port 4180 --strictPort > /dev/null 2>&1 &)
  sleep 4
  curl -s -o /dev/null -m 5 http://localhost:4180/ || { echo "$c: server did not start"; pkill -f "vite preview --outDir"; continue; }
  BASE=http://localhost:4180 NAME=$c OUT=$OUT/$sha.json node --experimental-websocket scripts/drive.mjs scripts/commit_steps.mjs 1512x900 $([ -n "${HEADLESS:-}" ] || echo --windowed) 2>/dev/null | python3 -c "
import sys,json
for line in sys.stdin:
    try: d=json.loads(line)
    except Exception: continue
    s,r,f=d['standing'],d['riding'],d['first']
    print(f\"{d['name']:9s} standing {s['fps']:3d} fps, worst {s['worst']:3d} ms, {s['scale']}x | riding {r['fps']:3d} fps, worst {r['worst']:3d} ms, {r['scale']}x | first 4 s {f['perSecond']}, worst {f['worstAfter']} ms (under the cover {f['worstUnderCover']} ms) | a frame costs {d['standingWork']['ms']} ms standing, {d['ridingWork']['ms']} ms riding (JavaScript {d['standingWork']['js']} and {d['ridingWork']['js']}) | cover lifts {d['load']} s after the last story card\")"
  pkill -f "vite preview --outDir"; sleep 1
done
