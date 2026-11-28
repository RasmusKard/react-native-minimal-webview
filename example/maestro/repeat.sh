#!/bin/bash
# Usage: maestro/repeat.sh <checkout> <commit> <android|ios> <device id> <runs> <out dir> [suite...]
# Checks out <commit> in <checkout>, a worktree with its packages installed. Installs that build on the
# device unless it is there already, serves that checkout's test pages and Metro, and runs its maestro/run.sh <runs>
# times. Each run's output, log and JUnit report go to <out dir> as <commit>-<time>.{out,log,xml}. Then prints
# pass-counts.mts over every report of that commit in <out dir>.
set -um
COUNTS=$(cd "$(dirname "$0")" && pwd)/pass-counts.mts
CHECKOUT=$1 COMMIT=$2 PLATFORM=$3 DEVICE=$4 RUNS=$5 OUT=$6; shift 6
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd) || exit 1
PAGES=http://localhost:${EXPO_PUBLIC_PAGES_PORT:-8090}
REPORT=${TMPDIR:-/tmp}; REPORT=${REPORT%/}/harness-$PLATFORM-$DEVICE
git -C "$CHECKOUT" checkout -q --detach "$COMMIT" || exit 1
sha=$(git -C "$CHECKOUT" rev-parse --short=9 HEAD)
cd "$CHECKOUT/example" || exit 1
maestro/install.sh --check "$PLATFORM" "$DEVICE" 2>/dev/null || maestro/install.sh "$PLATFORM" "$DEVICE" || exit 1

for url in http://localhost:${RCT_METRO_PORT:-8081}/status "$PAGES"; do
  curl -s "$url" >/dev/null && { echo "$url already answers: stop the server running there"; exit 1; }
done
node test-pages/server.js >> "$OUT/$sha-test-pages.log" 2>&1 & pages=$!
CI=1 pnpm exec expo start >> "$OUT/$sha-metro.log" 2>&1 & metro=$!
trap 'kill -- -$pages -$metro 2>/dev/null' EXIT
until curl -s http://localhost:${RCT_METRO_PORT:-8081}/status | grep -q running && curl -s "$PAGES" >/dev/null; do
  kill -0 $pages $metro 2>/dev/null || { echo "a server exited: see $OUT/$sha-*.log"; exit 1; }
  sleep 1
done

for i in $(seq "$RUNS"); do
  run=$OUT/$sha-$(date -u +%Y%m%dT%H%M%S)
  rm -f "$REPORT.xml"
  maestro/run.sh "$PLATFORM" "$DEVICE" "$@" > "$run.out" 2>&1
  status=$?
  grep -q '<testcase' "$REPORT.xml" 2>/dev/null || { echo "run $i reported no checks: see $run.out"; exit 1; }
  cp "$REPORT.log" "$run.log" && cp "$REPORT.xml" "$run.xml"
  echo "$sha run $i/$RUNS: exit $status, $(grep "checks passed" "$run.out")"
done
node --no-warnings "$COUNTS" "$OUT/$sha"-*.xml
