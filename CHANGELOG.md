# Changelog

## Unreleased

### Breaking

- Props: `onLoad` is gone; `onLoadEnd`'s `state.outcome` says how the load ended (`finished`, `failed` or `cancelled`).
- Props: `onHttpError` is gone; `onError` gets `{ kind: 'http', url, statusCode }` too.
- Props: `onDownload`'s result has `ok` (`true` for a `Download`, `false` for a `DownloadFailure`) to narrow on.
- Props: `onProcessGone` no longer resends a POST `source` on its own. It reports `recovered: false`, and `reload()` sends it.
- Types: `PermissionRequestEvent` is `PermissionRequest`, and `WebViewErrorEvent` and `WebViewHttpErrorEvent` are one `LoadErrorEvent`. Asks are `…Request`, notifications `…Event`, except a hook's asks and events, both `HookEvent`, and `onDownload`'s `Download` and `DownloadFailure`.
- Types: `WebViewProps` is an interface that extends `ViewProps` and includes `ref`.
- Ref: error codes are lowercase: `ERR_EVALUATE` is `script_error`, `ERR_NATIVE` is `native_error`. Android's `get` and `call` reject any exception with `native_error`, not only a refused key.
- Ref: a handle kept after its WebView unmounted rejects `evaluate`, `get`, `call` and `hook` with `unavailable` instead of resolving `undefined`. iOS `get` and `call` without a WKWebView reject with `unavailable`, not `native_error`.
- Ref: `get` and `call` refuse more. Android: `destroy`, navigations, listeners and other core-owned methods, and `get` takes only a getter or a non-void method. iOS: `init`, `copy`, `new` and `mutable` selectors, KVO and `setDelegate`.
- Rules: a new window to an internal scheme (`data:`, `blob:`, `javascript:`, `about:`) or `file:` is blocked whatever the rules say. `mailto:` and `tel:` still go through the rules.
- Bridge: `attach` to a second mounted WebView throws.
- Bridge: `Bridge` has a `[CONNECTION]` key that only `createBridge` sets, so a hand-made or mock `Bridge` no longer type-checks (it connected nothing to the WebView). The emitted types name `BridgeConnection`.
- Bridge: handlers and listeners get a second `{ origin }` argument, the sender's origin as the native side verified it. The `onBridge` native event carries `origin`.
- Bridge: `handler_error` messages no longer start with `Error: `.
- Bridge: the `BridgeError` type is gone: a call rejects with a `BridgeCallError`, and `invalid` is no longer a `BridgeErrorCode`.
- Settings: iOS `allowsInlineMediaPlayback` defaults to `true`.
- Settings: JS no longer sends the platforms' own defaults for `javaScriptCanOpenWindowsAutomatically` and gesture-only playback, so such a key you remove keeps its value until the WebView is recreated.
- Hooks: `nativeOptions` is `hookOptions`, `onNativeEvent` is `onHookEvent`, and the `NativeEvent` type is `HookEvent<N, P>` (`N` and `P` type the name and payload).
- Hooks: `MinimalWebViewHooks.register(key, configure:, attach:)` replaces the `configure` and `attach` maps. `context.options` is the hook's own `hookOptions` value, not every hook's, and a `false` value attaches no hook.
- Hooks (Android): `context.activity` is gone: use `appContext.currentActivity` in the hook's own module. The closure `attach` returns takes no reason: read it in `onDocumentEnd`, which runs just before.
- Hooks (iOS): commit and crash callbacks reach hooks after the core, and observation callbacks reach every hook, as on Android.
- Hooks (Android): a client that overrides a deprecated variant the platform forwards to (`shouldOverrideUrlLoading(WebView, String)`, `shouldInterceptRequest(WebView, String)`, the 4-argument `onReceivedError`, `onConsoleMessage(String, Int, String)`) counts as overriding the callback, so it now gets it and takes its decision: its `shouldOverrideUrlLoading` switches the navigation rules off.
- Native (Android): the view class `MinimalWebView`, `NavigationRules` and the `WebViewSource` and `InjectedScript` records are `internal`, as on iOS, so Kotlin outside the package that names them no longer compiles. Hooks keep `MinimalWebViewHooks`, `WebViewContext` and `DocumentScope`.
- Native: the view's `native` function is split into `get(path)` and `call(path, argsJson, completion)`.
- Package: an `exports` map: only `minimal-rn-webview` and `minimal-rn-webview/package.json` resolve.

### Added

- Navigation state: `outcome`, how the last load ended.
- Bridge: `createBridge<Methods, Events>` types the method names, params, results and event payloads.
- Bridge: a per-call `{ timeoutMs }` (`0` or `Infinity` for none).
- Asks: `onNavigationRequest`, `onFileRequest`, `onPermissionRequest` and a hook ask's `onHookEvent` get an `AbortSignal` that aborts when native stops waiting.
- Hooks: `ref.hook(name, method, args)` and `context.handle`; `context.url`, `context.onDocumentEnd` and `context.onOptionsChange`; a changed `hookOptions` value reaches its hook live; Android hooks get `configure`.
- Types: `WebViewErrorCode` and `CodedError` for ref method rejections, `FullscreenChangeEvent`, `BridgeCallError`, `BridgeMethodMap` and `BridgeEventMap`.
- Ref (iOS): `call` takes `{ cookie: properties }` for an `NSHTTPCookie` and resolves one as its properties, so JS sets and reads cookies through `httpCookieStore` without a native module.
- Docs: [Migrating from react-native-webview](docs/migrating-from-react-native-webview.md).

### Changed

- A change of a creation key remounts the whole `WebView`, so its state, ref attachment and bridge start over.
- Bridge: the unsubscribe that `handle()` returns removes only its own handler.
- Rules: until the next commit, a URL an `ask` allowed is allowed without asking again on a redirect back to it (Android) or for the same kind of frame (iOS). An `intent:` that falls back to its `browser_fallback_url` is reported as `block`.
- Crash recovery (iOS): reloads in place and keeps the back-forward list. Only the ref's `reload()` and a `source` change reset the crash guard, not a recovery reload.
- Crash recovery (iOS): a page whose URL differs from the `source` uri only in trailing slashes (`/page/` for `/page`) is the source's page, as on Android: a crash reloads the source with its headers, and a POST `source` there isn't sent again unasked. A crash exactly 60 s after an earlier one counts toward the crash guard's 3, as on Android.
- Crash recovery (Android): the crash guard counts for the whole app, and the reports of one renderer death count once. Only the ref's `reload()` resets it, not pull-to-refresh or a `source` change. The new WebView keeps the history, unless the page on screen is the `source` or the reload was held back, and is built only once the app is in the foreground and the view on screen. Until then, `evaluate`, `get`, `call` and `hook` reject with `unavailable`, and a new `source` loads on the new WebView.
- Hooks (iOS): the hook context is weak, the hooks' user scripts survive the core's script reset, and live settings apply before hooks attach.
- Hooks (iOS): `context.emit` and `context.ask` can be called from any thread, as on Android; they hop to the main thread.
- iOS `evaluate` rejects with the thrown error's own message.
- Android downloads run on one IO thread, with a 100 MB cap.
- Peer floors are Expo 53 and React Native 0.79, verified by a build and smoke run on SDK 53 and 55.

### Fixed

- Android crash recovery reloads the source with its headers, ends the cut-off load (`loading: false`), re-emits the navigation state, and `reload()` works after the guard gives up.
- iOS `sharedCookies`: cookies the page deletes are deleted from `HTTPCookieStorage` too, so a logout sticks.
- iOS `call` rejects a `{ data }` that isn't base64 instead of passing nil.
- Android downloads leave no partial files after a failure.
- Android fullscreen video restores the app's system bars.
- The Android bridge listener ignores non-string messages.
- iOS `get`/`call` result conversion can't crash.
- Hooks: a kept context's `ask` after the view closed answers null at once; it could stay unanswered.
- Rules (iOS): a URL that is only a scheme and a colon (`about:`, `myapp:`) is decided by that scheme, as on Android. It read as no scheme, so a bare `about:` went external instead of allowing, and a `scheme` rule never matched it.
- The navigation state, `onNavigation` and `onProcessGone` events no longer carry React Native's `target` key.
- LICENSE names the right copyright holder.
