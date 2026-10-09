#!/bin/bash
# Usage: maestro/run.sh <android|ios> <device id> [suite...]
# Runs harness suites in one Maestro session, one flow per suite: <suite>.yaml when the suite needs a driver (gestures,
# dialogs, renderer kills), else a generated wrapper that runs suite.yaml with SUITE set. One session because Maestro's
# start-up (~10 s) otherwise costs more than most suites; every flow still relaunches the app. Needs Metro, the test
# pages server (npm run test-pages) and the example app installed on the device. MAESTRO overrides the maestro binary.
set -u
cd "$(dirname "$0")" || exit 1
PLATFORM=$1 DEVICE=$2; shift 2
ANDROID_SUITES="urlTracking navigation reissue bridge injection errors crash recreate overlays upload downloads permissions fullscreen info ua dialogs sampleExtension ptr network"
IOS_SUITES="urlTracking navigation reissue bridge injection errors crash recreate overlays downloads permissions info ua dialogs sampleExtension ptr network"
[ $# -eq 0 ] && { [ "$PLATFORM" = android ] && set -- $ANDROID_SUITES || set -- $IOS_SUITES; }
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
[ $status -eq 0 ] || echo "debug output in ~/.maestro/tests"
exit $status
