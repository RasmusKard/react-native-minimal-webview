#!/bin/bash
# Usage: maestro/run.sh <android|ios> <device id> [suite...]
# Runs harness suites in one Maestro session, one flow per suite: <suite>.yaml when the suite needs a driver (gestures,
# dialogs, renderer kills), else a generated wrapper that runs suite.yaml with SUITE set. One session because Maestro's
# start-up (~10 s) otherwise costs more than most suites. The app stays up between suites, and Maestro waits on the
# test server rather than the screen (subflows/). Needs Metro, the test pages server (npm run test-pages) and the
# example app installed on the device. Prints the failed checks at the end. MAESTRO overrides the maestro binary.
set -u
cd "$(dirname "$0")" || exit 1
PLATFORM=$1 DEVICE=$2; shift 2
ANDROID_SUITES="urlTracking navigation reissue bridge backForward injection errors crash mountSettings settings overlays upload downloads permissions fullscreen info ua dialogs sampleExtension ptr network sources"
IOS_SUITES="urlTracking navigation reissue bridge backForward injection errors crash mountSettings settings overlays downloads permissions info ua dialogs sampleExtension ptr network sources"
[ $# -eq 0 ] && { [ "$PLATFORM" = android ] && set -- $ANDROID_SUITES || set -- $IOS_SUITES; }
if [ "$PLATFORM" = android ]; then
  # Root for the crash suite's renderer kills (it restarts adbd, so before the reverses), then the device's localhost
  # ports to Metro and the test server (http, and https for the SSL check).
  adb -s "$DEVICE" root >/dev/null && adb -s "$DEVICE" wait-for-device
  for port in 8081 8090 8443; do adb -s "$DEVICE" reverse tcp:$port tcp:$port >/dev/null; done
fi
# The run's first suite launches the app fresh; later ones reuse it while it passes (subflows/launch.yaml).
curl -sf "http://localhost:8090/harness/fresh?platform=$PLATFORM" >/dev/null || { echo "no test pages server on :8090"; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
flows=()
for suite in "$@"; do
  if [ -f "$suite.yaml" ]; then flows+=("$suite.yaml"); continue; fi
  printf 'appId: expo.modules.minimalwebview.example\nname: %s\n---\n- runFlow: { file: %s/suite.yaml, env: { SUITE: %s } }\n' \
    "$suite" "$PWD" "$suite" > "$tmp/$suite.yaml"
  flows+=("$tmp/$suite.yaml")
done
"${MAESTRO:-maestro}" --device "$DEVICE" test --no-ansi -e PLATFORM="$PLATFORM" -e DEVICE="$DEVICE" "${flows[@]}" > "$tmp/out" 2>&1
status=$?
# Per-suite results and the summary; Maestro's own error if it never got to run a flow.
grep -E '^\[(Passed|Failed)\]|Flows? (Passed|Failed)' "$tmp/out" || tail -20 "$tmp/out"
curl -s "http://localhost:8090/harness/failures?platform=$PLATFORM"
[ $status -eq 0 ] || echo "debug output in ~/.maestro/tests"
exit $status
