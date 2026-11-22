#!/bin/bash
# Usage: maestro/install.sh [--check] <android|ios> <device id> [expo run option...]
# Builds the example app and installs it on the device, and notes what it was built from.
# --check builds nothing: it fails unless the app on the device is that install, and what a native build reads is as it
# was then.
set -eu
cd "$(dirname "$0")/.."
[ "$1" = --check ] && { check=1; shift; }
PLATFORM=$1 DEVICE=$2 APP=expo.modules.minimalwebview.example
note=.expo/installed-$PLATFORM-$DEVICE

built_from() {
  {
    git -C .. ls-files -co --exclude-standard -z -- ios android extensions expo-module.config.json example/modules \
      example/app.json example/package.json ':!*.ts' ':!*.tsx' ':!*.md' | (cd .. && xargs -0 shasum 2>/dev/null)
    shasum node_modules/.package-lock.json
  } | shasum
}
installed() {
  if [ "$PLATFORM" = ios ]; then
    xcrun simctl get_app_container "$DEVICE" $APP
  else
    adb -s "$DEVICE" shell dumpsys package $APP | grep lastUpdateTime
  fi
}

if [ "${check:-}" ]; then
  [ "$(cat "$note" 2>/dev/null)" = "$(built_from; installed)" ] && exit 0
  echo "the app on $DEVICE is not a build of this checkout as it is now: run maestro/install.sh $PLATFORM $DEVICE"
  exit 1
fi
from=$(built_from)
npx expo run:"$PLATFORM" --no-bundler --device "$DEVICE" "${@:3}"
mkdir -p .expo
{ echo "$from"; installed; } > "$note"
