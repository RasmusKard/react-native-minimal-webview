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
- `onDownload`: a result has `ok` (`true` for a `Download`, `false` for a `DownloadFailure`) to narrow on.
- iOS `allowsInlineMediaPlayback` defaults to `true`.
- JS no longer sends the platforms' own defaults for `javaScriptCanOpenWindowsAutomatically` and gesture-only playback: such a key you remove keeps its value until the WebView is recreated.
- Hooks: `nativeOptions` is `hookOptions`, `onNativeEvent` is `onHookEvent`, and the `NativeEvent` type is `HookEvent<N, P>` (`N` and `P` type the name and payload). Native hook code reads `context.options` as before.
- Types: `PermissionRequestEvent` is `PermissionRequest`, `WebViewErrorEvent` is `LoadErrorEvent`. Asks are `…Request`, notifications `…Event`.
- Ref error codes are lowercase: `ERR_EVALUATE` is `script_error`, `ERR_NATIVE` is `native_error`. Android's `get` and `call` reject any exception with `native_error`, not only a refused key.
- `WebViewProps` is an interface that extends `ViewProps` and includes `ref`.
- Native: the view's `native` function is split into `get(path)` and `call(path, argsJson, completion)`.

### Added

- Bridge: per-call `{ timeoutMs }` (`0` or `Infinity` for none).
- Types: `WebViewErrorCode` and `CodedError` for ref method rejections, and `FullscreenChangeEvent`.

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
- The navigation state, `onNavigation` and `onProcessGone` events no longer carry React Native's `target` key.
