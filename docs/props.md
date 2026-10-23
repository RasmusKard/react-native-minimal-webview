# Props and ref methods

| Prop | Notes |
|---|---|
| `source` | `{ uri, headers?, body? }` or `{ html, baseUrl? }`. `headers` go on the first request only. `body` makes it a form-urlencoded POST (Android sends no `headers` with it); `reload()` sends it again, crash recovery doesn't (`onProcessGone` says `recovered: false`). A `file://` uri loads with read access to its directory; Android needs `android.settings.allowFileAccess: true` |
| `ios`, `android` | Any WebKit property or Android setter, by name. See [Platform settings](platform-settings.md) |
| `userAgent` | Replaces the user agent (`ios.webView.customUserAgent`, `android.settings.userAgentString`). To append to the default one instead: `ios.configuration.applicationNameForUserAgent`, and on Android `android.settings.userAgentString` from `WebView.defaultUserAgent` plus your suffix |
| `injectedScripts` | `[{ code, mainFrameOnly? }]`, run at document start, before the page's scripts, in the main frame only unless `mainFrameOnly: false`; code for the parsed DOM goes in `addEventListener('DOMContentLoaded', …)`. Changes apply from the next navigation |
| `navigationRules`, `onNavigationRequest`, `onNavigation`, `onOpenExternal` | See [Navigation rules](navigation-rules.md) |
| `bridge` | `createBridge(...)`, see [The bridge](bridge.md). Read when the WebView is created: a change recreates it |
| `pullToRefresh` | Pull down at the top of the page to reload: `UIRefreshControl`, or `SwipeRefreshLayout` (a pull inside a scrolled inner scroller, `overflow: auto`, scrolls it instead) |
| `sharedCookies` | iOS: copies `HTTPCookieStorage` into the WebView before each `source` load (the load waits for it), and the WebView's cookie changes, deletions included, back as they happen. Android needs nothing: `CookieManager` is app-wide, flushed when the app backgrounds |
| `onFileRequest`, `onFullscreenChange`, `onPermissionRequest`, `onDownload` | See [Page requests](page-requests.md). They can be added and removed at any time |
| `hookOptions`, `onHookEvent` | What your [native hooks](native-hooks.md) get, and what they send. Its keys pick the hooks when the WebView is created; a changed value reaches its hook live |
| `onNavigationStateChange` | Every change to the [navigation state](navigation-state.md) |
| `onLoadStart`, `onLoadEnd` | The navigation state when `loading` goes true, and when it goes false. `onLoadEnd`'s `state.outcome` says how the load ended: `finished`, `failed` (a network or SSL error, or a crash cut it off) or `cancelled` (it never showed a page: a stop before the response, a download, a 204, a redirect the rules blocked, a load a newer one replaced). An HTTP error status (404) is `finished`: the site's page shows. A stop after the page arrived is `cancelled` on iOS and `finished` on Android. On Android with a WebView older than 146, a load that never commits fires neither event ([versions](#android-system-webview-versions)) |
| `onError` | Main-frame errors only. `{ kind: 'network' \| 'ssl', url, code, description }`: the load failed (`outcome: 'failed'`). SSL errors are always cancelled. `{ kind: 'http', url, statusCode }`: the response had an HTTP error status (400+), and the site's own error page shows. On Android with a WebView older than 146, an SSL error on a back/forward load isn't reported ([versions](#android-system-webview-versions)) |
| `onProcessGone` | `{ didCrash, recovered }`. With `recovered: true` the core reloads the page. Android builds a new WebView with the back/forward history restored, and not before the app is in the foreground and the view is on screen. It doesn't send a POST `source` again unasked (`recovered: false`; `reload()` sends it), and after more than 3 crashes in 60 s it stops reloading, until the next `source` change or `reload()`. Android's WebViews share one renderer: each one reports its death, and the 3 count for the app, not per view |
| `style`, `testID`, `nativeID`, `accessibilityLabel` and the other `ViewProps` | Go to the native view |

## Ref methods

`goBack`, `goForward`, `reload` (retries the failed URL after an error), `stopLoading`, `evaluate(expression)`, and
`get(key)` and `call(method, args?, options?)` from [Platform settings](platform-settings.md). The committed `url` is
in the [navigation state](navigation-state.md).

`evaluate` runs an expression (not statements) in the main frame and awaits a returned Promise. The value comes back
through JSON, so what JSON can't encode (a function, `NaN`, a cycle) gives `null` and a `Date` gives its ISO string. A
throw or rejection rejects with code `script_error`, a navigation or crash before the script finishes with `navigated`,
and on Android a WebView older than 101 with `unavailable` ([versions](#android-system-webview-versions)). On a ref handle that outlived its WebView
(kept from before an unmount), `evaluate`, `get`, `call` and `hook` reject with `unavailable`, and the other ref
methods do nothing. The result is whatever the page's own JS
returns, so treat it as page data. On Android it comes back through a global that pages see, `window.nativeEvaluateResult` (see [Security defaults](security.md)).

A ref method rejects with a `CodedError`, an `Error` whose `code` is a `WebViewErrorCode`: `script_error` (`evaluate`),
`native_error` (`get`, `call`, and a `hook` reply that can't cross as JSON), `navigated`, `unavailable` or
`hook_not_handled` (`hook`).

## Starting early

`WebView.warmUp()`, Android only (a no-op on iOS): starts WebView in the background (`WebViewCompat.startUpWebView`),
so the first WebView mounts faster and its first request goes out sooner. Call it at app start when a WebView shows
soon after; called right before the mount it gains less. React Native's networking already starts WebView at the app's
first `fetch` (its cookie jar is WebView's `CookieManager`), so an app that fetches early gets part of this anyway.

`WebView.preconnect(url)`, Android only (a no-op on iOS): opens a connection to `url`'s origin (DNS, TCP, TLS) in
WebView's default profile, for a load that follows (`Profile.enqueuePreconnect`, else `Profile.preconnect`; nothing
on a WebView without them). It starts WebView on the UI thread if nothing has yet, so call it after `warmUp()` has had
time or once a WebView is mounted, a moment before the load, so the connection is ready when it starts. Prefetch and
prerender aren't wrapped: reach them through `ProfileStore` in a [native hook](native-hooks.md).

## Loading and error screens

There is no `renderLoading` or `renderError`: the navigation state and `onError` give the same screens, under your own
layout ([recipe](migrating-from-react-native-webview.md#loading-and-error-screens)).

## Android System WebView versions

Android System WebView updates apart from the OS (through the Play Store; Huawei and Fire OS devices ship their own
builds), so what a device can do depends on its WebView, not its API level. The core checks each WebView feature at
run time: an older WebView loses the features below, and nothing crashes. WebView 146 and newer has all of them.

| WebView | Feature | Below it |
|---|---|---|
| 101 | `WEB_MESSAGE_LISTENER`, `DOCUMENT_START_SCRIPT` | Bridge calls reject with `unavailable`, `injectedScripts` don't run (each warns once per process), and `evaluate` rejects with `unavailable`, so `blob:` downloads fail. API 29+ devices with WebView updates on have it; the API 29 Google APIs emulator image ships 91 |
| 146 | `NAVIGATION_LISTENER` | `pendingUrl` stays `null` (`url` still follows commits and SPA navigation). A load that never commits fires neither `onLoadStart` nor `onLoadEnd`. An SSL error on a back/forward load isn't reported. The back-forward cache stays off (WebView 133 reports no page finish for a restored page). Seen on WebView 133: `100vh` is 0 after crash recovery, back doesn't leave fullscreen video, an open file chooser is cancelled only when the next page commits, and the `paymentRequestEnabled` setting isn't supported |

Other features are checked one by one: `preconnect` does nothing without `Profile.enqueuePreconnect` or `preconnect`,
favicon downloads stay on without `downloadFaviconsEnabled`, and an `android` setting this WebView lacks is skipped with
a warning.
