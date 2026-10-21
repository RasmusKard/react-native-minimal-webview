# Changelog

## Unreleased

### Breaking

- Bridge: `attach` to a second mounted WebView throws.
- Bridge: `handler_error` messages no longer start with `Error: `.
- Bridge: handlers and listeners get a second `{ origin }` argument, the sender's origin as the native side verified it. The `onBridge` native event carries `origin`.
- `onProcessGone`: a POST source is no longer resent on its own. It reports `recovered: false`, and `reload()` sends it.
- Rules: `newWindow` to an internal scheme (`data:`, `blob:`, `javascript:`, `about:`) or `file:` is blocked whatever the rules say. `mailto:` and `tel:` still go through the rules.
- `get`/`call` refuse more methods: on Android `destroy`, navigations, listeners, core-owned and void methods; on iOS `init`/`copy`/`new`/`mutable*`, KVO and `setDelegate` selectors.
- iOS hooks: commit and crash callbacks reach hooks after the core, and observation callbacks reach every hook, as on Android.
- The package has an `exports` map: only `react-native-minimal-webview` and `react-native-minimal-webview/package.json` resolve.

### Added

- Bridge: per-call `{ timeoutMs }` (`0` or `Infinity` for none).

### Changed

- A change of a creation key remounts the whole `WebView`, so its state, ref attachment and bridge start over.
- Bridge: the unsubscribe that `handle()` returns removes only its own handler.
- iOS crash recovery reloads in place and keeps the back-forward list.
- iOS hooks: the hook context is weak, the hooks' user scripts survive the core's script reset, and live settings apply before hooks attach.
- Android downloads run on one IO thread, with a 100 MB cap.
- Peer floors are Expo 53 and React Native 0.79, verified by a build and smoke run on SDK 53 and 55.

### Fixed

- Android crash recovery reloads the source with its headers, ends the cut-off load (`loading: false`), re-emits the navigation state, and `reload()` works after the guard gives up.
- iOS `sharedCookies`: cookies the page deletes are deleted from `HTTPCookieStorage` too, so a logout sticks.
- Android downloads leave no partial files after a failure.
- Android fullscreen video restores the app's system bars.
- The Android bridge listener ignores non-string messages.
- iOS `get`/`call` result conversion can't crash.
- LICENSE names the right copyright holder.
