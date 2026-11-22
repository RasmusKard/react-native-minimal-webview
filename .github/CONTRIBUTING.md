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

`example/maestro/install.sh android <adb serial>` or `example/maestro/install.sh ios <simulator udid>` builds and
installs the example app, and generates `example/android` or `example/ios` the first time. The on-device suites run
only on an app installed this way, and not after a native source or an installed package has changed since.

Dependabot leaves Expo's packages, React and React Native alone: they only work as the set Expo names, and the root and
`example/` stay on the same one. The `Expo packages` workflow opens a PR that moves both each week. By hand, in the root
and in `example/`: `npx expo install --fix`, then `npx -y npm@11 install` for the lockfile.

## Checks

```sh
# Both packages: TS tests, ESLint and Prettier, knip, type-checks (the docs' samples too), build, TSDoc, that the
# generated files are current, that the DocC landing page lists every public Swift type, that the root and example/
# resolve the same Expo, React and React Native, and that the ios and kotlin workflows' cache keys hash every file their
# jobs read
npm run check
# Stryker on the files .config/stryker.config.json lists
npm run mutation
# The bridge protocol's TLA+ model in src/__tests__/bridge-model; --mutants also checks that each property catches a broken variant
node .github/scripts/check-bridge-model.mts --mutants
# Kotlin tests, and the extensions' Kotlin compiled; -PmrwCoverage adds JaCoCo coverage
(cd example/android && ./gradlew :react-native-minimal-webview:testDebugUnitTest :react-native-minimal-webview-extensions:compileDebugKotlin :sample-extension:compileDebugKotlin)
# Swift tests
ios/Tests/run.sh
detekt --input android/src/main,extensions --config .config/detekt.yml
swiftlint lint --config .config/swiftlint.yml
# Builds the example app, so it needs example/ios
periphery scan --config .config/periphery.yml
```

## Docs site

The `docs` workflow builds the site and deploys it to GitHub Pages on every push to `main`. `npm run docs` builds it
locally: it generates the API reference for TypeScript, Kotlin and Swift and writes the site to `build/docs/site/site`.
Kotlin and Swift build the library, so it needs `example/android` and `example/ios`. How the site is laid out:
[rn-cross-platform-docs](https://github.com/RasmusKard/rn-cross-platform-docs#cli).

## On-device suites

The suites (one file each in `example/suites/`, listed in `names.ts`) run inside the example app, and Maestro drives
them: one flow, `example/maestro/suite.yaml`, does on the device what a suite asks for. In `example/`, start
the test pages server (`npm run test-pages`) and Metro (`npx expo start`), install the app, then:

```sh
example/maestro/run.sh android <adb serial>                  # every suite
example/maestro/run.sh ios <simulator udid> bridge network   # only the named ones
```

`run.sh` prints the failed checks and saves the run to `$TMPDIR`: its log as `harness-<platform>-<device>.log` and its
checks as a JUnit report, the same name with `.xml`. `example/maestro/self-test.sh <platform> <device>` checks that a
failing suite fails a run. To tell a flaky check from a regression, run `example/maestro/repeat.sh` on the commits
before and after a change: it runs suites a given number of times on a commit and counts how many runs passed each
check.

Run the app on one device per platform at a time: every instance of a platform takes its suites from the same queue.
A second checkout runs its suites beside the first with a test pages server of its own: set `EXPO_PUBLIC_PAGES_PORT`
and `EXPO_PUBLIC_PAGES_HTTPS_PORT` for the server, Metro and `run.sh`.

The suites run a debug build, which R8 doesn't shrink, so they don't check `android/consumer-rules.pro`. After a change
to it, or to what `PlatformSettings.kt` finds by reflection, run the settings suite on a release build:

```sh
example/maestro/install.sh android <adb serial> --variant release
example/maestro/run.sh android <adb serial> settings
```

Android emulators need a Google APIs system image:
[guides/android-system-webview.md](../guides/android-system-webview.md#test-the-oldest-versions) says why. Start them
with `-gpu host`, or they may render in software.

```sh
sdkmanager 'system-images;android-37.1;google_apis_ps16k;arm64-v8a'
avdmanager create avd -n mrw-api37 -k 'system-images;android-37.1;google_apis_ps16k;arm64-v8a' -d pixel_9_pro
emulator -avd mrw-api37 -gpu host
```

For the oldest versions the suites run on (they need `evaluate`, so not a WebView older than 83):

- Android API 29, WebView 91: the `android-29` Google APIs image
- Android WebView 133: the `android-36` Google APIs image
- iOS 17.0: the simulator runtime's dmg from Apple's developer downloads, installed with `xcrun simctl runtime add <dmg>`
