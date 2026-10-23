# Development

```sh
npm install && (cd example && npm install)
npm run check                              # the next four lines in one: test, lint, knip, both type-checks, prepare
npm test                                   # TS unit tests (bridge protocol and types, createBridge, origin matcher, WebView, native contract, page client)
npm run lint && npm run prepare            # ESLint on src, example and .github (a warning fails it too); then a clean build
npx tsc --noEmit -p src/__tests__/tsconfig.json && (cd example && npx tsc --noEmit)   # type-check the tests and the example
npx knip                                   # unused files, exports and dependencies (not example/)
(cd example && npx expo prebuild --platform android --no-install)          # once, if example/android doesn't exist yet
(cd example/android && ./gradlew :minimal-rn-webview:testDebugUnitTest)   # Kotlin navigation matcher, DocumentScope, hooks, clients, crash-loop guard
xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/DocumentScope.swift ios/Asks.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules
npm run mutation                           # Stryker on src/bridge (fails below an 80% score)
```

The code's shape, as reports rather than checks: the native thresholds are starting points that today's code exceeds.
detekt, swiftlint, periphery and cloc are CLIs (Homebrew), not npm dependencies.

```sh
detekt --input android/src/main --config detekt.yml   # Kotlin complexity and unused private code (the rules are in detekt.yml)
swiftlint lint                                        # Swift complexity (.swiftlint.yml)
periphery scan                                        # unused Swift (.periphery.yml); builds the example app itself (needs example/ios, see below), ~40 s
npx stryker run --mutate src/WebView.tsx,src/refStore.ts   # WebView.test.tsx's mutation score, under the 80% gate today
cloc --quiet --exclude-dir=__tests__,Tests,test --not-match-f='\.generated\.' src ios android/src/main   # lines per layer
```

Two files are generated, and `npm test` fails when either is stale (its `pretest` runs both scripts with `--check`):
- `src/bridge/pageClient.generated.ts`, from `pageClient.ts` and `endpoint.ts`: `npm run build:page-client` after
  editing either.
- `src/platform.generated.ts`, the settings keys and the `WK` and `Android` constants, from the SDK extracts in
  `.github/scripts/platform-headers/`: `npm run gen:platform-types`. After an Xcode, Android SDK or androidx.webkit
  upgrade, `npm run gen:platform-types -- --import` refreshes the extracts from the installed SDKs first.

The matchers share their test cases in `src/__tests__/vectors/`: the navigation cases run on Kotlin and Swift, the origin
cases on TS and Swift. There is no Kotlin origin matcher: Android's WebView matches origins itself
(`addWebMessageListener`).

## On-device suites

The suites (`SUITES` in `example/harness.ts`) run inside the example app and make every WebView assertion there.
[Maestro](https://maestro.dev) only drives them: a flow in `example/maestro/` starts a suite, performs the gestures,
taps, dialog presses and renderer kills it asks for (`<suite>#<n> <REQUEST>`, on screen and posted to the test pages
server), and fails unless the suite ends with `fail=0`.

Before a run:
1. In `example/`, start the test pages server with `npm run test-pages` (port 8090, and 8443 for https with a
   self-signed certificate) and Metro with `npx expo start --clear`. Metro serves edits in `src/` and `example/` within
   seconds (it watches the repo root), and each run starts with a fresh app launch, so no restart is needed after a JS
   edit. Don't edit JS during a run: Fast Refresh pushes it into the running app mid-suite. Restart with `--clear` only
   after changing the Metro or Babel config or dependencies.
2. Install the app. The first `npx expo run:android` or `npx expo run:ios` in `example/` generates the native project;
   after that:
   - Android: `cd example/android && ./gradlew app:installDebug`
   - iOS: `cd example/ios && pod install`, then `xcodebuild -workspace minimalrnwebviewexample.xcworkspace -scheme
     minimalrnwebviewexample -configuration Debug -destination 'id=<udid>' -derivedDataPath build build`, then
     `xcrun simctl install <udid> build/Build/Products/Debug-iphonesimulator/minimalrnwebviewexample.app`
3. Keep the app running on one device per platform at a time. Every instance of a platform polls the same harness
   queue.

`example/maestro/run.sh` runs the suites, all in one Maestro session:

```bash
example/maestro/run.sh android emulator-5556                    # every suite in SUITES (each skips what its platform lacks)
example/maestro/run.sh ios <simulator udid> ptr dialogs network  # only the named suites
```

- Each suite gets its own `[Passed]`/`[Failed]` line, and the failed checks print at the end. A failure doesn't stop
  the rest. The script exits non-zero if any suite failed.
- The app launches once per run and stays up: the harness resets itself after each suite, and Maestro waits on the
  test server, not the screen. The next suite relaunches the app only after a failed or cut-off one.
- On Android, `run.sh` does `adb root` (for renderer kills) and the `adb reverse` ports itself.
- A full run takes about 3 minutes per platform, also with Android and iOS running at the same time (each platform has
  its own harness queue). Start the second ~10 s after the first: once, two Maestro CLIs starting in the same second
  killed Android's device server.
- Debug output for failed runs is in `~/.maestro/tests`. The test pages server prints every check, with timestamps.
- A suite can also be started by hand: `curl 'localhost:8090/harness/run?platform=android&suite=urlTracking'`.

Android emulators: use Google APIs system images (`google_apis`), never Play Store ones (`google_apis_playstore`). On
a Play Store image the Play Store updates Android System WebView in the background soon after boot, so a run silently
tests a newer WebView than the image ships. Start the emulator with `-gpu host`. With the default (`auto`) it can come
up rendering in software (`adb shell dumpsys SurfaceFlinger | grep GLES` names SwiftShader), and a full run takes
nearly twice as long.

Reference emulators: `mrw-api37` (Google APIs, API 37, WebView 149) is the one every suite passes on. On `mrw-api36`
(API 36, WebView 133) some checks are known limits of a WebView older than 146
([Android System WebView versions](props.md#android-system-webview-versions)), and the harness reports them as
`INFO ... known limit (WebView <146): <check>` instead of passing or failing them.

To add a suite: add it to `SUITES` in `example/harness.ts` (`run.sh` reads its keys). A suite that doesn't apply to a
platform reports `skipped` there and ends. If it needs gestures, taps, dialogs or renderer kills, add a `<suite>.yaml`
flow in `example/maestro/`. Otherwise `run.sh` wraps
the generic `suite.yaml` for it. A suite must leave nothing behind that `reset()` in `harness.ts` doesn't undo, and
must not depend on a site outside the test pages server.
