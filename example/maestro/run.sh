#!/bin/bash
# Usage: maestro/run.sh <android|ios> <device id> [suite...]
# Runs harness suites through Maestro, one flow per suite: <suite>.yaml when the suite needs a driver (gestures,
# dialogs, renderer kills), else suite.yaml. Needs Metro, the test pages server (npm run test-pages) and the example app
# installed on the device. MAESTRO overrides the maestro binary.
set -u
cd "$(dirname "$0")" || exit 1
PLATFORM=$1 DEVICE=$2; shift 2
ANDROID_SUITES="urlTracking navigation reissue bridge injection errors crash recreate overlays upload downloads permissions fullscreen info ua dialogs sampleExtension ptr borrowed parity"
IOS_SUITES="urlTracking navigation reissue bridge injection errors crash recreate overlays downloads permissions info ua dialogs sampleExtension ptr borrowed parity"
[ $# -eq 0 ] && { [ "$PLATFORM" = android ] && set -- $ANDROID_SUITES || set -- $IOS_SUITES; }
failed=()
for suite in "$@"; do
  flow=suite.yaml; [ -f "$suite.yaml" ] && flow=$suite.yaml
  if "${MAESTRO:-maestro}" --device "$DEVICE" test -e SUITE="$suite" -e PLATFORM="$PLATFORM" -e DEVICE="$DEVICE" "$flow" >/dev/null 2>&1; then
    echo "PASS $suite"
  else
    echo "FAIL $suite (debug output in ~/.maestro/tests)"; failed+=("$suite")
  fi
done
echo "${#failed[@]} of $# suites failed${failed[*]:+: ${failed[*]}}"
[ ${#failed[@]} -eq 0 ]
