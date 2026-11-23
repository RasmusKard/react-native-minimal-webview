#!/bin/bash
# Usage: maestro/point-app.sh <android|ios> <device id>
# Stops the app and points it at the Metro on RCT_METRO_PORT (default 8081). The app keeps the Metro it was pointed at
# before, another checkout's too: on Android `debug_http_host` in its preferences, on iOS `RCT_jsLocation` in its
# defaults. Does nothing when the app isn't installed, or on Android isn't debuggable (no Metro then).
set -u
PLATFORM=$1 DEVICE=$2 APP=expo.modules.minimalwebview.example METRO=${RCT_METRO_PORT:-8081}
if [ "$PLATFORM" = android ]; then
  adb -s "$DEVICE" shell run-as $APP true 2>/dev/null || exit 0
  adb -s "$DEVICE" shell am force-stop $APP
  [ "$METRO" = 8081 ] && host='' || host="<string name=\"debug_http_host\">localhost:$METRO</string>"
  adb -s "$DEVICE" shell run-as $APP sh <<EOF
f=shared_prefs/${APP}_preferences.xml
[ -f \$f ] || [ -n '$host' ] || exit 0
mkdir -p shared_prefs && [ -f \$f ] || echo '<map />' > \$f
sed -i -e 's#<string name="debug_http_host">[^<]*</string>##' -e 's#<map />#<map></map>#' -e 's#<map>#<map>$host#' \$f
EOF
else
  data=$(xcrun simctl get_app_container "$DEVICE" $APP data 2>/dev/null) || exit 0
  xcrun simctl terminate "$DEVICE" $APP 2>/dev/null
  # The app also reads the simulator's own defaults for its bundle id, which `defaults write <bundle id>` sets.
  for domain in "$data/Library/Preferences/$APP.plist" $APP; do
    xcrun simctl spawn "$DEVICE" defaults delete "$domain" RCT_jsLocation 2>/dev/null
  done
  [ "$METRO" = 8081 ] ||
    xcrun simctl spawn "$DEVICE" defaults write "$data/Library/Preferences/$APP.plist" RCT_jsLocation "localhost:$METRO"
fi
