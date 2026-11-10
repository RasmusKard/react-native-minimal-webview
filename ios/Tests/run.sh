#!/usr/bin/env bash
# The Swift tests, on macOS (.github/workflows/swift.yml says what they cover). Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentEnd.swift ios/Asks.swift ios/Recovery.swift \
  ios/DelegateProxy.swift ios/ReadAccess.swift ios/Tests/main.swift -o "$out/rules"
"$out/rules"

# The PlatformSettings tests, as Mac Catalyst.
F="$(xcrun --sdk macosx --show-sdk-path)/System/iOSSupport/System/Library/Frameworks"
T=arm64-apple-ios17.0-macabi
xcrun clang -target $T -iframework "$F" -fobjc-arc -r -nostdlib ios/MRWExceptions.m ios/MRWInvoke.m -o "$out/mrw.o"
xcrun swiftc -target $T -Fsystem "$F" -import-objc-header ios/Tests/PlatformSettings/Bridging.h \
  ios/PlatformSettings.swift ios/PlatformCompletions.generated.swift ios/Tests/PlatformSettings/main.swift "$out/mrw.o" \
  -o "$out/settings"
"$out/settings"
