# Development

## Setup

- Node 22 (`.nvmrc`) and npm
- Android: JDK 17 and the Android SDK, with an emulator
- iOS: Xcode and CocoaPods
- [Maestro](https://maestro.dev), which drives the on-device suites
- detekt, SwiftLint and Periphery: `brew install detekt swiftlint periphery`

```sh
npm install && (cd example && npm install)
```

The root `npm install` also sets up `extensions/`, the `@react-native-minimal-webview/extensions` package, as an npm workspace.

In `example/`, `npx expo run:android --no-bundler` or `npx expo run:ios --no-bundler --device <udid>` builds and
installs the example app, and generates `example/android` or `example/ios` the first time.

## Checks

```sh
npm run check                                                              # both packages: TS tests, ESLint, knip, type-checks, build, docs
(cd example/android && ./gradlew :react-native-minimal-webview:testDebugUnitTest)   # Kotlin tests; -PmrwCoverage adds JaCoCo coverage
xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentScope.swift ios/Asks.swift ios/Recovery.swift ios/DelegateProxy.swift ios/ReadAccess.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules   # Swift tests
F="$(xcrun --sdk macosx --show-sdk-path)/System/iOSSupport/System/Library/Frameworks" T=arm64-apple-ios17.0-macabi   # with the next line: the PlatformSettings tests, as Mac Catalyst
xcrun clang -target $T -iframework "$F" -fobjc-arc -r -nostdlib ios/MRWExceptions.m ios/MRWInvoke.m -o /tmp/mrw.o && xcrun swiftc -target $T -Fsystem "$F" -import-objc-header ios/Tests/PlatformSettings/Bridging.h ios/PlatformSettings.swift ios/PlatformCompletions.generated.swift ios/Tests/PlatformSettings/main.swift /tmp/mrw.o -o /tmp/settings && /tmp/settings
detekt --input android/src/main,extensions --config .config/detekt.yml
swiftlint lint --config .config/swiftlint.yml
periphery scan --config .config/periphery.yml                              # builds the example app, so it needs example/ios
```

## On-device suites

The suites (`SUITES` in `example/harness.ts`) run inside the example app, and Maestro drives them. In `example/`, start
the test pages server (`npm run test-pages`) and Metro (`npx expo start`), install the app, then:

```sh
example/maestro/run.sh android <adb serial>                  # every suite
example/maestro/run.sh ios <simulator udid> bridge network   # only the named ones
```

Run the app on one device per platform at a time: every instance of a platform takes its suites from the same queue.

Android emulators need a Google APIs system image, not a Play Store one: the Play Store updates Android System WebView
in the background. Start them with `-gpu host`, or they may render in software.

```sh
sdkmanager 'system-images;android-37.1;google_apis_ps16k;arm64-v8a'
avdmanager create avd -n mrw-api37 -k 'system-images;android-37.1;google_apis_ps16k;arm64-v8a' -d pixel_9_pro
emulator -avd mrw-api37 -gpu host
```

For the oldest supported versions:

- Android API 29, WebView 91: the `android-29` Google APIs image
- Android WebView 133: the `android-36` Google APIs image
- iOS 17.0: the simulator runtime's dmg from Apple's developer downloads, installed with `xcrun simctl runtime add <dmg>`
