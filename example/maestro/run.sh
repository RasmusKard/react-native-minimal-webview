#!/bin/bash
# Usage: maestro/run.sh <android|ios> <device id> [suite...]
# Runs harness suites in one Maestro session, one flow per suite: a generated wrapper that runs suite.yaml with SUITE
# set. One session, because Maestro's start-up otherwise repeats for every suite. Needs Metro, the test pages server (npm run test-pages) and the example
# app installed on the device. MAESTRO overrides the maestro binary, and ../pages.ts's variables the server's
# ports.
set -u
cd "$(dirname "$0")" || exit 1
PLATFORM=$1 DEVICE=$2; shift 2
PORT=${EXPO_PUBLIC_PAGES_PORT:-8090} PAGES=http://localhost:${EXPO_PUBLIC_PAGES_PORT:-8090}
# No suites named: a full run (suites that don't apply to a platform skip themselves).
[ $# -eq 0 ] && set -- $(node --no-warnings -p "require('../suites/names.ts').SUITE_NAMES.join(' ')")
if [ "$PLATFORM" = android ]; then
  # Root for the crash suite's renderer kills (it restarts adbd, so before the reverses), then the device's localhost
  # ports to Metro and the test server (http, and https for the SSL check).
  adb -s "$DEVICE" root >/dev/null && adb -s "$DEVICE" wait-for-device
  for port in 8081 $PORT ${EXPO_PUBLIC_PAGES_HTTPS_PORT:-8443}; do adb -s "$DEVICE" reverse tcp:$port tcp:$port >/dev/null; done
  # Android's one-time "Viewing full screen" notice takes focus when the fullscreen suite hides the bars, and the
  # back key then goes to it instead of the app.
  adb -s "$DEVICE" shell settings put secure immersive_mode_confirmations confirmed
fi
# /harness/fresh makes the run's first suite launch the app fresh.
curl -sf "$PAGES/harness/fresh?platform=$PLATFORM&device=$DEVICE" >/dev/null || { echo "no test pages server on :$PORT"; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
flows=()
for suite in "$@"; do
  printf 'appId: expo.modules.minimalwebview.example\nname: %s\n---\n- runFlow: { file: %s/suite.yaml, env: { SUITE: %s } }\n' \
    "$suite" "$PWD" "$suite" > "$tmp/$suite.yaml"
  flows+=("$tmp/$suite.yaml")
done
"${MAESTRO:-maestro}" --device "$DEVICE" test --no-ansi -e PAGES="$PAGES" -e PLATFORM="$PLATFORM" "${flows[@]}" > "$tmp/out" 2>&1
status=$?
# Per-suite results and the summary; Maestro's own error if it never got to run a flow.
grep -E '^\[(Passed|Failed)\]|Flows? (Passed|Failed)' "$tmp/out" || tail -20 "$tmp/out"
# The app's log of the run: its failed checks here, all of it in a file.
log=${TMPDIR:-/tmp}; log=${log%/}/harness-$PLATFORM-$DEVICE.log
curl -s "$PAGES/harness/log?platform=$PLATFORM" > "$log"
grep ' FAIL ' "$log"
echo "$(grep -c ' PASS ' "$log") checks passed, $(grep -c ' FAIL ' "$log") failed: $log"
[ $status -eq 0 ] || echo "debug output in ~/.maestro/tests"
exit $status
