# minimal-rn-webview

## Breaking changes

The package has no releases and no users yet. Don't avoid a breaking change, or add a compatibility shim, when it
makes the API, the interfaces, reliability or the code simpler or better. Say in the commit or PR what breaks.

## On-device suites

The suites live in `example/harness.ts` (`SUITES`) and run inside the example app. `example/maestro/run.sh` starts
them through Maestro, all in one Maestro session:

```bash
example/maestro/run.sh android emulator-5556                    # every suite in run.sh's list for the platform
example/maestro/run.sh ios <simulator udid> ptr dialogs network  # only the named suites, same single session
```

- Each suite still relaunches the app and gets its own `[Passed]`/`[Failed]` line. A failure doesn't stop the rest.
  The script exits non-zero if any suite failed.
- A full run takes about 4 minutes per platform. Run it in the foreground; it fits in one 10-minute tool call.
- Debug output for failed runs is in `~/.maestro/tests`.

Android emulators: use Google APIs system images (`google_apis`), never Play Store ones (`google_apis_playstore`).
On a Play Store image the Play Store updates Android System WebView in the background soon after boot, so a run
silently tests a newer WebView than the image ships. A Google APIs image keeps its factory WebView.

Before a run:
1. In `example/`, start the test pages server with `npm run test-pages` (port 8090) and Metro with
   `npx expo start --clear`. Restart Metro with `--clear` after any JS edit in `src/` or `example/`; otherwise it
   can serve a stale bundle and old harness code runs.
2. Install the app:
   - Android: `cd example/android && ./gradlew app:installDebug`
   - iOS: `cd example/ios && pod install`, then `xcodebuild -workspace minimalrnwebviewexample.xcworkspace -scheme
     minimalrnwebviewexample -configuration Debug -destination 'id=<udid>' -derivedDataPath build build`, then
     `xcrun simctl install <udid> build/Build/Products/Debug-iphonesimulator/minimalrnwebviewexample.app`
3. Android only: `adb root` (the `crash` suite kills the renderer), then `adb reverse tcp:8081 tcp:8081` and
   `adb reverse tcp:8090 tcp:8090`. Run the `reverse` commands after `root`, because `root` restarts adbd.
4. iOS only: keep the app running on one simulator at a time. Every iOS instance polls the same harness queue.

To add a suite: add it to `SUITES` in `example/harness.ts` and to the platform lists in `run.sh`. If it needs
gestures, taps, dialogs or renderer kills, add a `<suite>.yaml` flow in `example/maestro/`. Otherwise `run.sh` wraps
the generic `suite.yaml` for it.
