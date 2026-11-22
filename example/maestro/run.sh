#!/bin/bash
# Usage: maestro/run.sh <android|ios> <device id> [suite...]
# MAESTRO overrides the maestro binary.
# One Maestro session runs every suite's flow: Maestro's start-up would otherwise repeat for each suite.
set -u
cd "$(dirname "$0")" || exit 1
PLATFORM=$1 DEVICE=$2; shift 2
PORT=${EXPO_PUBLIC_PAGES_PORT:-8090} PAGES=http://localhost:${EXPO_PUBLIC_PAGES_PORT:-8090}
./install.sh --check "$PLATFORM" "$DEVICE" || exit 1
SUITE_MS=$(node --no-warnings -p "require('../suites/names.ts').SUITE_MS")
[ $# -eq 0 ] && set -- $(node --no-warnings -p "require('../suites/names.ts').SUITE_NAMES.join(' ')")
if [ "$PLATFORM" = android ]; then
  # Root for the crash suite's renderer kills (it restarts adbd, so before the reverses).
  adb -s "$DEVICE" root >/dev/null && adb -s "$DEVICE" wait-for-device
  for port in 8081 $PORT ${EXPO_PUBLIC_PAGES_HTTPS_PORT:-8443}; do adb -s "$DEVICE" reverse tcp:$port tcp:$port >/dev/null; done
  # Android's one-time "Viewing full screen" notice takes focus when the fullscreen suite hides the bars, and the
  # back key then goes to it instead of the app.
  adb -s "$DEVICE" shell settings put secure immersive_mode_confirmations confirmed
fi
curl -sf "$PAGES/harness/start-run?platform=$PLATFORM&device=$DEVICE" >/dev/null || { echo "no test pages server on :$PORT"; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
flows=()
for suite in "$@"; do
  printf 'appId: expo.modules.minimalwebview.example\nname: %s\n---\n- runFlow: { file: %s/suite.yaml, env: { SUITE: %s } }\n' \
    "$suite" "$PWD" "$suite" > "$tmp/$suite.yaml"
  flows+=("$tmp/$suite.yaml")
done
"${MAESTRO:-maestro}" --device "$DEVICE" test --no-ansi -e PAGES="$PAGES" -e PLATFORM="$PLATFORM" -e SUITE_MS="$SUITE_MS" "${flows[@]}" > "$tmp/out" 2>&1
status=$?
grep -E '^\[(Passed|Failed)\]|Flows? (Passed|Failed)' "$tmp/out" || tail -20 "$tmp/out"
log=${TMPDIR:-/tmp}; log=${log%/}/harness-$PLATFORM-$DEVICE.log
curl -s "$PAGES/harness/log?platform=$PLATFORM" > "$log"
curl -s "$PAGES/harness/junit?platform=$PLATFORM" > "${log%.log}.xml"
grep ' FAIL ' "$log"
echo "$(grep -c ' PASS ' "$log") checks passed, $(grep -c ' FAIL ' "$log") failed, $(grep -c ' SKIP ' "$log") skipped: $log (.xml: JUnit)"
[ $status -eq 0 ] || echo "debug output in ~/.maestro/tests"
exit $status
