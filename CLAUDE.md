# react-native-minimal-webview

## Breaking changes

The package has no releases and no users yet. Don't avoid a breaking change, or add a compatibility shim, when it
makes the API, the interfaces, reliability or the code simpler or better. Say in the commit or PR what breaks.

## Pull requests

Ask before opening a PR. Committing and pushing to a branch is fine without asking.

## On-device suites

The suites live in `example/harness.ts` (`SUITES`) and run inside the example app. `example/maestro/run.sh` starts
them through Maestro, all in one Maestro session:

```bash
example/maestro/run.sh android emulator-5556                    # every suite in run.sh's list for the platform
example/maestro/run.sh ios <simulator udid> ptr dialogs network  # only the named suites, same single session
```

- Each suite gets its own `[Passed]`/`[Failed]` line, and the failed checks print at the end. A failure doesn't stop
  the rest. The script exits non-zero if any suite failed.
- The app launches once per run and stays up: the harness resets itself after each suite, and Maestro waits on the
  test server, not the screen. The next suite relaunches the app only after a failed or cut-off one.
- A full run takes about 3 minutes per platform, also with Android and iOS running at the same time (each platform has
  its own harness queue). Start the second ~10 s after the first: once, two Maestro CLIs starting in the same second
  killed Android's device server. Each fits in one 10-minute tool call.
- Debug output for failed runs is in `~/.maestro/tests`. The test pages server prints every check, with timestamps.

Android emulators: use Google APIs system images (`google_apis`), never Play Store ones (`google_apis_playstore`).
On a Play Store image the Play Store updates Android System WebView in the background soon after boot, so a run
silently tests a newer WebView than the image ships. A Google APIs image keeps its factory WebView.
Start the emulator with `-gpu host`. With the default (`auto`) it can come up rendering in software: then
`adb shell dumpsys SurfaceFlinger | grep GLES` names SwiftShader, the app takes ~5 s to start instead of under 1 s,
and a full run takes nearly twice as long.

Before a run:
1. In `example/`, start the test pages server with `npm run test-pages` (port 8090, and 8443 for https) and Metro with
   `npx expo start --clear`. Metro serves edits in `src/` and `example/` within seconds (it watches the repo root),
   and each run starts with a fresh app launch, so no restart is needed after a JS edit. Don't edit JS during a run:
   Fast Refresh pushes it into the running app mid-suite. Restart with `--clear` only after changing the Metro or
   Babel config or dependencies.
2. Install the app:
   - Android: `cd example/android && ./gradlew app:installDebug`
   - iOS: `cd example/ios && pod install`, then `xcodebuild -workspace reactnativeminimalwebviewexample.xcworkspace -scheme
     reactnativeminimalwebviewexample -configuration Debug -destination 'id=<udid>' -derivedDataPath build build`, then
     `xcrun simctl install <udid> build/Build/Products/Debug-iphonesimulator/reactnativeminimalwebviewexample.app`
3. iOS only: keep the app running on one simulator at a time. Every iOS instance polls the same harness queue.
   (On Android, `run.sh` does `adb root` and the `adb reverse` ports itself.)

To add a suite: add it to `SUITES` in `example/harness.ts` and to the platform lists in `run.sh`. If it needs
gestures, taps, dialogs or renderer kills, add a `<suite>.yaml` flow in `example/maestro/`. Otherwise `run.sh` wraps
the generic `suite.yaml` for it. A suite must leave nothing behind that `reset()` in `harness.ts` doesn't undo, and
must not depend on a site outside the test pages server.
