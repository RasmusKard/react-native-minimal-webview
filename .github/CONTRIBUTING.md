# Development

## Setup

- Node 22 (`.nvmrc`) and npm
- Android: JDK 17 and the Android SDK, with an emulator
- iOS: Xcode and CocoaPods
- [Maestro](https://maestro.dev), which drives the on-device suites
- detekt, SwiftLint and Periphery: `brew install detekt swiftlint periphery`
- [uv](https://docs.astral.sh/uv/getting-started/installation/), which runs Zensical for the docs site

```sh
npm install && (cd example && npm install)
```

The root `npm install` also sets up `extensions/`, the `@react-native-minimal-webview/extensions` package, as an npm workspace.

In `example/`, `npx expo run:android --no-bundler` or `npx expo run:ios --no-bundler --device <udid>` builds and
installs the example app, and generates `example/android` or `example/ios` the first time.

## Checks

```sh
npm run check                                                              # both packages: TS tests, ESLint and Prettier, knip, type-checks (the docs' samples too), build, TSDoc
npm run mutation                                                           # Stryker on the files .config/stryker.config.json lists; fails below its break threshold
(cd example/android && ./gradlew :react-native-minimal-webview:testDebugUnitTest :react-native-minimal-webview-extensions:compileDebugKotlin :sample-extension:compileDebugKotlin)   # Kotlin tests, and the extensions' Kotlin compiled; -PmrwCoverage adds JaCoCo coverage
ios/Tests/run.sh                                                           # Swift tests, the PlatformSettings ones as Mac Catalyst
detekt --input android/src/main,extensions --config .config/detekt.yml
swiftlint lint --config .config/swiftlint.yml
periphery scan --config .config/periphery.yml                              # builds the example app, so it needs example/ios
```

## Docs site

`npm run docs` generates the API reference for TypeScript, Kotlin and Swift and replaces `docs/`, which GitHub Pages
serves, with the built site. Kotlin and Swift build the library, so it needs `example/android` and `example/ios`. How
the site is laid out: [rn-cross-platform-docs](https://github.com/RasmusKard/rn-cross-platform-docs#zensical-site).

## On-device suites

The suites (`SUITES` in `example/harness.ts`) run inside the example app, and Maestro drives them. In `example/`, start
the test pages server (`npm run test-pages`) and Metro (`npx expo start`), install the app, then:

```sh
example/maestro/run.sh android <adb serial>                  # every suite
example/maestro/run.sh ios <simulator udid> bridge network   # only the named ones
```

Run the app on one device per platform at a time: every instance of a platform takes its suites from the same queue.

Android emulators need a Google APIs system image:
[guides/android-system-webview.md](../guides/android-system-webview.md#test-the-oldest-versions) says why. Start them
with `-gpu host`, or they may render in software.

```sh
sdkmanager 'system-images;android-37.1;google_apis_ps16k;arm64-v8a'
avdmanager create avd -n mrw-api37 -k 'system-images;android-37.1;google_apis_ps16k;arm64-v8a' -d pixel_9_pro
emulator -avd mrw-api37 -gpu host
```

For the oldest supported versions:

- Android API 29, WebView 91: the `android-29` Google APIs image
- Android WebView 133: the `android-36` Google APIs image
- iOS 17.0: the simulator runtime's dmg from Apple's developer downloads, installed with `xcrun simctl runtime add <dmg>`
