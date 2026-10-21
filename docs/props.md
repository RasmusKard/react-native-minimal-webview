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
| `nativeOptions`, `onNativeEvent` | What your [native hooks](native-hooks.md) get, and what they send. `nativeOptions` is read when the WebView is created, like `bridge` |
| `onNavigationStateChange`, `onLoadStart`, `onLoad`, `onLoadEnd` | `onLoad` doesn't fire for a failed load |
| `onError` | `{ kind: 'network' \| 'ssl', url, code, description }`: the load failed. Main-frame errors only. SSL errors are always cancelled. On Android with a WebView older than 146, an SSL error on a back/forward load isn't reported |
| `onHttpError` | `{ url, statusCode, description }`: the main frame got an HTTP error status (400+), and the site's own error page shows |
| `onProcessGone` | `{ didCrash, recovered }`. The core has already reloaded the page (`recovered: true`). It doesn't send a POST `source` again unasked (`recovered: false`; `reload()` sends it), and after more than 3 crashes in 60 s it stops reloading, until the next `source` change or `reload()` |
| `style`, `testID`, `nativeID`, `accessibilityLabel` and the other `ViewProps` | Go to the native view |

## Ref methods

`goBack`, `goForward`, `reload` (retries the failed URL after an error), `stopLoading`, `evaluate(expression)`, and
`get(key)` and `call(method, args?, options?)` from [Platform settings](platform-settings.md). The committed `url` is
in the [navigation state](navigation-state.md).

`evaluate` runs an expression (not statements) in the main frame and awaits a returned Promise. The value comes back
through JSON, so what JSON can't encode (a function, `NaN`, a cycle) gives `null` and a `Date` gives its ISO string. A
throw or rejection rejects with code `ERR_EVALUATE`, a navigation or crash before the script finishes with `navigated`,
and on Android a WebView without `WEB_MESSAGE_LISTENER` with `unavailable`. Before the WebView is mounted, `evaluate`,
`get` and `call` resolve `undefined`, as the other ref methods do nothing. The result is whatever the page's own JS
returns, so treat it as page data. On Android it comes back through a global that pages see, `window.nativeEvaluateResult` (see [Security defaults](security.md)).

## Starting early

`WebView.warmUp()`, Android only (a no-op on iOS): starts WebView in the background (`WebViewCompat.startUpWebView`),
so the first WebView mounts faster. Call it at app start when a WebView shows soon after. With the first WebView mounted
1 s after app start, its constructor blocked the UI thread for 24 ms instead of 72 ms, and its first request went out
50 ms sooner (WebView 149, release build). Called right before the mount it gains less. React Native's networking
already starts WebView at the app's first `fetch` (its cookie jar is WebView's `CookieManager`), so an app that fetches
early gets part of this anyway.

`WebView.preconnect(url)`, Android only (a no-op on iOS): opens a connection to `url`'s origin (DNS, TCP, TLS) in
WebView's default profile, for a load that follows (`Profile.enqueuePreconnect`, else `Profile.preconnect`; nothing
on a WebView without them). It starts WebView on the UI thread if nothing has yet, so call it after `warmUp()` has had
time or once a WebView is mounted. Called 1.5 s before loading https://www.delfi.ee/, the page's first byte came after
111 ms instead of 683 ms (median of 12, WebView 149 on an emulator, debug build). Prefetch and prerender aren't wrapped:
reach them through `ProfileStore` in a [native hook](native-hooks.md).

## Loading and error screens

There is no `renderLoading` or `renderError`: the navigation state and `onError` give the same screens, under your own
layout.

```tsx
const { loading } = useWebViewState(ref);
const [error, setError] = useState<WebViewErrorEvent | null>(null);
<View style={{ flex: 1 }}>
  <WebView ref={ref} source={source} onError={setError} onLoadStart={() => setError(null)} style={{ flex: 1 }} />
  {error ? (
    <OfflineScreen style={StyleSheet.absoluteFill} error={error} onRetry={() => ref.current?.reload()} />
  ) : loading ? (
    <ActivityIndicator style={StyleSheet.absoluteFill} />
  ) : null}
</View>
```

An HTTP error status (404, 503) is not a failed load: `onHttpError` fires instead.
