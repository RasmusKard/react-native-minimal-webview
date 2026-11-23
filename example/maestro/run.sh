#!/bin/bash
# Usage: maestro/run.sh <android|ios> <device id> [suite...]
# MAESTRO overrides the maestro binary. BACKGROUND_MS (default 5000) is how long a background kill waits before
# it brings the app back. RCT_METRO_PORT (default 8081) is this checkout's Metro, EXPO_PUBLIC_PAGES_PORT (default 8090)
# its test pages server: the run stops unless both serve this checkout.
# One Maestro session runs every suite's flow: Maestro's start-up would otherwise repeat for each suite.
set -u
cd "$(dirname "$0")" || exit 1
PLATFORM=$1 DEVICE=$2; shift 2
PORT=${EXPO_PUBLIC_PAGES_PORT:-8090} PAGES=http://localhost:${EXPO_PUBLIC_PAGES_PORT:-8090}
METRO=${RCT_METRO_PORT:-8081}
./install.sh --check "$PLATFORM" "$DEVICE" || exit 1
ROOT=$(cd .. && pwd -P)
served_root() { curl -s -m 60 -o /dev/null -w "%header{$2}" "$1"; }
[ "$(served_root "http://localhost:$METRO/status" X-React-Native-Project-Root)" = "$ROOT" ] ||
  { echo "no Metro of this checkout on :$METRO: run npx expo start in example/, with RCT_METRO_PORT=$METRO"; exit 1; }
[ "$(served_root "$PAGES/" X-Project-Root)" = "$ROOT" ] ||
  { echo "no test pages server of this checkout on :$PORT: run npm run test-pages in example/"; exit 1; }
./point-app.sh "$PLATFORM" "$DEVICE" || exit 1
SUITE_MS=$(node --no-warnings -p "require('../suites/names.ts').SUITE_MS")
[ $# -eq 0 ] && set -- $(node --no-warnings -p "require('../suites/names.ts').SUITE_NAMES.join(' ')")
if [ "$PLATFORM" = android ]; then
  # Root for the crash suite's renderer kills (it restarts adbd, so before the reverses).
  adb -s "$DEVICE" root >/dev/null && adb -s "$DEVICE" wait-for-device
  for port in $METRO $PORT ${EXPO_PUBLIC_PAGES_HTTPS_PORT:-8443}; do adb -s "$DEVICE" reverse tcp:$port tcp:$port >/dev/null; done
  # Android's one-time "Viewing full screen" notice takes focus when the fullscreen suite hides the bars, and the
  # back key then goes to it instead of the app.
  adb -s "$DEVICE" shell settings put secure immersive_mode_confirmations confirmed
fi
curl -sf "$PAGES/harness/start-run?platform=$PLATFORM&device=$DEVICE" >/dev/null || exit 1
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
flows=()
for suite in "$@"; do
  printf 'appId: expo.modules.minimalwebview.example\nname: %s\n---\n- runFlow: { file: %s/suite.yaml, env: { SUITE: %s } }\n' \
    "$suite" "$PWD" "$suite" > "$tmp/$suite.yaml"
  flows+=("$tmp/$suite.yaml")
done
# Two Maestro CLIs that start in the same second can end one's session: each starts 10 s after the one before.
start=${TMPDIR:-/tmp}/maestro-start
lockf -k "$start" sh -c 'wait=$(($(stat -f %m "$1") + 10 - $(date +%s))); [ $wait -le 0 ] || sleep $wait; touch "$1"' - "$start"
"${MAESTRO:-maestro}" --device "$DEVICE" test --no-ansi -e PAGES="$PAGES" -e PLATFORM="$PLATFORM" -e SUITE_MS="$SUITE_MS" -e BACKGROUND_MS="${BACKGROUND_MS:-5000}" "${flows[@]}" > "$tmp/out" 2>&1
status=$?
grep -E '^\[(Passed|Failed)\]|Flows? (Passed|Failed)' "$tmp/out" || tail -20 "$tmp/out"
log=${TMPDIR:-/tmp}; log=${log%/}/harness-$PLATFORM-$DEVICE.log
curl -s "$PAGES/harness/log?platform=$PLATFORM" > "$log"
curl -s "$PAGES/harness/junit?platform=$PLATFORM" > "${log%.log}.xml"
grep ' FAIL ' "$log"
echo "$(grep -c ' PASS ' "$log") checks passed, $(grep -c ' FAIL ' "$log") failed, $(grep -c ' SKIP ' "$log") skipped: $log (.xml: JUnit)"
[ $status -eq 0 ] || echo "debug output in ~/.maestro/tests"
exit $status
