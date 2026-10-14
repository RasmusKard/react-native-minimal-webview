# minimal-rn-webview

A small, extensible WebView for React Native, built with the Expo Modules API (Swift and Kotlin), for the new architecture only.

- **Native decides, JS is told.**
  - Navigation rules run natively: no JS round trip per navigation, and the UI thread never blocks.
  - Only `onNavigationRequest` and the page-request props (`onFileRequest`, `onPermissionRequest`, `onHttpAuthRequest`) can change an outcome. Each has a safe default without the prop.
- **One committed URL, owned by native.** `useWebViewState(ref)` gives `url`, `pendingUrl`, `title`, `loading`, `progress`, `canGoBack` and `canGoForward`. `url` is the page on screen: it changes when a load commits and on SPA navigation (pushState, replaceState, hash), and stays the old page while a load is in progress. After a failed load it is the failed URL. `pendingUrl` is a main-frame load in progress, which may still fail or be blocked. Iframes never change either.
- **A promise bridge** between React Native and the page, restricted to the origins you allow.
- **Page requests just work:** file chooser, fullscreen video, permissions, downloads and HTTP auth each have a default, and an optional prop takes one over.
- **Every platform setting by name,** without a change to this package: `ios={{ scrollView: { bounces: false } }}`,
  `android={{ settings: { textZoom: 120 } }}`.
- **The app owns device APIs.** The library never shows OS permission prompts or pickers itself. It has no config plugin and no dependency on expo-camera, expo-image-picker or similar packages.

**Requirements:**
- iOS 16.4.
- Android API 29+. Set `minSdkVersion 29`, for example with `expo-build-properties`.
- Expo SDK 53+ (React Native 0.79+, React 19) with the new architecture. A bare React Native app works too, once it has the `expo` package through `npx install-expo-modules@latest`.

On Android, a few features depend on the device's Android System WebView. Any API 29+ device with WebView updates
enabled has them all.
- `when: 'end'` injected scripts need WebView 146+; older ones skip them.
- The bridge and `when: 'start'` scripts need the `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT` features; without
  them bridge calls reject with `unavailable` and start scripts don't run. `evaluate` (and so `blob:` downloads) needs
  `WEB_MESSAGE_LISTENER`. Both are in WebView 101 and newer.

For the bridge and `injectedScripts`, the library warns about a missing feature once per process, in every build. To
gate on it, check what the device supports:

```ts
const info = WebView.androidWebViewInfo; // null on iOS
const canBridge = info?.features.WEB_MESSAGE_LISTENER !== false && info?.features.DOCUMENT_START_SCRIPT !== false;
const canEndScripts = info?.features.JS_INJECTION_IN_FRAME_AND_WORLD !== false;
```

## Quick start

```tsx
import { useRef } from 'react';
import { WebView, useWebViewState, type WebViewRef } from 'minimal-rn-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const { url, loading, canGoBack } = useWebViewState(ref);
  return (
    <WebView
      ref={ref}
      source={{ uri: 'https://example.com' }}
      navigationRules={[
        { host: ['example.com', '*.example.com'], action: 'allow' },
        { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
        { action: 'external' }, // everything else: other sites, tel: and mailto: links, new windows
      ]}
      style={{ flex: 1 }}
    />
  );
}
```

`useWebViewState(ref)` re-renders with each change of the navigation state, and follows the WebView when it remounts
(a new `key`, a conditional render). While no WebView is mounted with `ref`, it is the initial state (`url: ''`).

### Outside React

For code outside React, such as a push notification handler, create the ref with `createWebViewRef()` at module
level and pass it as `ref`:

```tsx
import { WebView, createWebViewRef } from 'minimal-rn-webview';

export const webView = createWebViewRef();

function onInboxNotification() {
  // The committed url of the mounted WebView, read synchronously; '' while none is mounted.
  if (webView.getState().url.startsWith('https://example.com/inbox')) webView.reload();
}

export function Browser() {
  return <WebView ref={webView} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

It works with `useWebViewState` too, and has the ref methods, forwarded to the WebView mounted with it (no-ops while none is: `evaluate` resolves
`undefined` and `getUrl` `''`), plus:

- `getState()`: the navigation state, synchronously. When the WebView unmounts it resets to the initial state, so a
  stale `url` never looks valid.
- `subscribe(listener)`: called on every change, including a WebView mounting or unmounting. Subscribers stay across
  remounts. Returns the unsubscribe function.
- `current`: the mounted WebView's ref, or `null` while none is mounted.

Give each mounted WebView its own ref. If two are mounted with the same one, the last mounted wins (with a warning in
development) until it unmounts.

## Navigation rules

Rules are an ordered list, and the first match wins. Every field a rule sets must match. `scheme`, `host` and `path`
are lists, and one entry matching is enough:

| Field | Matches |
|---|---|
| `scheme` | Exact, case-insensitive: `['tel', 'mailto']` |
| `host` | Exact, or `*.example.com` for subdomains only (not `example.com` itself). Case, port, userinfo and a trailing dot are ignored |
| `path` | A plain prefix of the percent-encoded path: `/checkout` also matches `/checkouts` |
| `mainFrame`, `newWindow`, `userInitiated` | true or false |

**Actions:**
- `allow`: load in place.
- `block`: cancel.
- `external`: hand to the OS, or to `onOpenExternal` if you set it.
- `ask`: call `onNavigationRequest`, which answers `allow`, `block` or `external` within 1 s. A late or missing answer counts as `block`, as does one still pending when another page commits. Without `onNavigationRequest`, `ask` blocks at once.

**Defaults:**
- With no rules, http(s) loads in place, `file:` is blocked and every other scheme opens externally from the main frame. A subframe's navigation to one is blocked. A new window counts as a main-frame navigation, so a tap in an iframe that runs `window.open('myapp://…')` still opens externally; without the `javaScriptCanOpenWindowsAutomatically` setting, only a tap opens a window.
- With rules but no match, the result is `block`.
- `about:`, `blob:`, `data:` and `javascript:` always load.

`onNavigation` reports every decision: `{ url, action, mainFrame, newWindow, userInitiated, rule }`.

**Platform differences:**
- **`ask` on Android.** Android can't pause a navigation, so `ask` cancels it, asks, and reissues it with `loadUrl` on `allow`. The reissued load loses the referrer and the gesture flag, and its redirect chain restarts. `ask` works only for the main frame on Android; for iframes it falls back to `block`. iOS holds the navigation and asks for any frame.
- **POST on Android.** Android never runs the rules for POST requests: form posts and payment redirects always load.
- **POST into a new window on Android.** A form POST to `target=_blank` can't be captured, so it doesn't load; iOS loads it in place.
- **iframes on Android.** Android only decides iframe navigations to non-http(s) schemes (`tel:`, `intent:` and so on). Rules for http(s) iframes, the `mainFrame: false` ones, apply only on iOS.
- **`userInitiated`.** On iOS it's true only for a tapped link (`.linkActivated`). A `location.href` change or `window.open` from a click handler is false on iOS but true on Android (`hasGesture()`).
- **Redirect loops.** A URL that `ask` allowed isn't asked again until the next page commits, so a redirect loop can't ask forever.
- **`intent:` links (Android).** They're sanitised: browsable only, with no explicit component or selector. If no app handles one, its `S.browser_fallback_url` loads instead.

## The bridge

```tsx
const bridge = useMemo(() => createBridge({ allowedOrigins: ['https://example.com', 'https://*.example.com'] }), []);
useEffect(
  () => bridge.handle('share', async ({ url }) => { await Share.share({ url, message }); return true }), // the unsubscribe
  [bridge, message]
);

<WebView bridge={bridge} … />
await bridge.call('getCartCount');   // a method the page registered
bridge.emit('themeChanged', 'dark');
```

Make the bridge once (`useMemo`, or at module level like `createWebViewRef`): a new one recreates the WebView. A
handler sees the values of the render that registered it, so register it in an effect with those values in the
deps; `handle` returns the unsubscribe, which the effect's cleanup runs.

In the page:

```js
await window.nativeBridge.call('share', { url: location.href });
window.nativeBridge.handle('getCartCount', () => cart.length);
window.nativeBridge.on('themeChanged', (theme) => applyTheme(theme));
```

**How it behaves:**
- **Errors are structured:** `{ code, message }`. The codes are `timeout`, `not_found`, `handler_error`, `navigated`, `unavailable` (an Android System WebView without the bridge's features; see Requirements) and `invalid`. Messages have no size limit.
- **Timeouts:** calls time out after 10 s by default (`timeoutMs`).
- **Navigation:** calls in flight are rejected with `navigated` when the page navigates or the WebView unmounts, and a page's own calls when it comes back from the back-forward cache. The other side may already have handled such a call, so retry only calls that are safe to repeat.
- **Page load:** calls and events from React Native wait until the page's DOM is parsed (`DOMContentLoaded`), so handlers and listeners registered by its synchronous or deferred scripts are in place. A page's own calls work earlier, and are answered at once.
- **One document:** every message is for one document. A call or event sent while the page navigates never reaches the next page, even on the same origin; it is rejected with `navigated` or dropped.
- **Origins:** pages outside `allowedOrigins` get no `window.nativeBridge`, and nothing is delivered to them. Only the main frame takes part. A rule is `*` (any origin, opaque ones too), `https://example.com[:port]`, `https://*.example.com[:port]` (subdomains only, not `example.com`) or an IP literal such as `http://[::1]:8080`; http or https only, no path, ASCII (punycode) hosts. Case is ignored, and a missing port means 80 or 443. One file of test cases (`src/__tests__/vectors/origin-rules.json`) checks every matcher.
- **Transports:** iOS uses a `WKScriptMessageHandler` plus `callAsyncJavaScript`; Android uses `addWebMessageListener` with origin rules.

Build your own page APIs on top of it, for example an injected `window.MyAppAPI` that calls the bridge.

### Web content written for react-native-webview

Pages that call `window.ReactNativeWebView.postMessage(string)` and listen for `message` events keep working through
the bridge. Only `allowedOrigins` get `ReactNativeWebView`, and only in the main frame; react-native-webview gives it
to every page and every iframe.

```tsx
const rnwMessages = {
  when: 'start', // after the bridge's own script, so `window.nativeBridge` already exists
  mainFrameOnly: true,
  code: `if (window.nativeBridge) {
    window.ReactNativeWebView = { postMessage: (data) => window.nativeBridge.emit('rnw', String(data)) };
    window.nativeBridge.on('rnw', (data) =>
      ${Platform.OS === 'ios' ? 'window' : 'document'}.dispatchEvent(new MessageEvent('message', { data })));
  }`,
} as const;

<WebView bridge={bridge} injectedScripts={[rnwMessages]} … />

useEffect(() => bridge.on('rnw', (data) => handleMessage(data as string)), [bridge]); // was onMessage
bridge.emit('rnw', message); // was ref.current.postMessage(message)
```

The `message` event goes to `window` on iOS and `document` on Android, as react-native-webview sends it.

### Scroll position

There is no `onScroll` prop. A start script reports the main frame's scroll position over the bridge, at most once
per frame:

```tsx
const scroll = {
  when: 'start',
  mainFrameOnly: true,
  code: `let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; window.nativeBridge?.emit('scroll', { x: scrollX, y: scrollY }); });
  }, { passive: true });`,
} as const;

<WebView bridge={bridge} injectedScripts={[scroll]} … />
useEffect(() => bridge.on('scroll', (position) => onScroll(position as { x: number; y: number })), [bridge]);
```

Only pages in `allowedOrigins` report. For offsets during a bounce or a pinch, a [native hook](#native-hooks) can
observe `scrollView.contentOffset` on iOS and `setOnScrollChangeListener` on Android.

## Props

| Prop | Notes |
|---|---|
| `source` | `{ uri, headers?, body? }` or `{ html, baseUrl? }`. `headers` go on the first request only. `body` makes it a form-urlencoded POST (Android sends no `headers` with it); `reload()` and crash recovery send it again. A `file://` uri loads with read access to its directory; Android needs `android.settings.allowFileAccess: true` |
| `ios`, `android` | Any WebKit property or Android setter, by name. See [Platform settings](#platform-settings) |
| `userAgent` | Replaces the user agent (`ios.webView.customUserAgent`, `android.settings.userAgentString`). To append to the default one instead: `ios.configuration.applicationNameForUserAgent` (read when the WebView is created: a change recreates it), and on Android `android.settings.userAgentString` from `WebView.defaultUserAgent` plus your suffix |
| `injectedScripts` | `[{ code, when: 'start' \| 'end', mainFrameOnly? }]`. Changes apply from the next navigation. On Android, `'end'` scripts need System WebView 146+ (see Requirements) |
| `navigationRules`, `onNavigationRequest`, `onNavigation`, `onOpenExternal` | See above |
| `bridge` | `createBridge(...)`. Read when the WebView is created: a change recreates it |
| `pullToRefresh` | Pull down at the top of the page to reload: `UIRefreshControl`, or `SwipeRefreshLayout` (a pull inside a scrolled inner scroller, `overflow: auto`, scrolls it instead) |
| `sharedCookies` | iOS: copies `HTTPCookieStorage` into the WebView before each `source` load (the first load waits for it), and the WebView's cookie changes back as they happen. Android needs nothing: `CookieManager` is app-wide, flushed when the app backgrounds |
| `onFileRequest`, `onFullscreenChange`, `onPermissionRequest`, `onDownload`, `onHttpAuthRequest` | See [Page requests](#page-requests). They can be added and removed at any time |
| `nativeOptions`, `onNativeEvent` | What your [native hooks](#native-hooks) get, and what they send. `nativeOptions` is read when the WebView is created, like `bridge` |
| `onNavigationStateChange`, `onLoadStart`, `onLoad`, `onLoadEnd` | `onLoad` doesn't fire for a failed load |
| `onError` | `{ kind: 'network' \| 'ssl', url, code, description }`: the load failed. Main-frame errors only. SSL errors are always cancelled |
| `onHttpError` | `{ url, statusCode, description }`: the main frame got an HTTP error status (400+), and the site's own error page shows |
| `onProcessGone` | `{ didCrash, recovered }`. The core has already reloaded the page; after more than 3 crashes in 60 s it stops reloading until the next `source` change |
| `style`, `testID`, `nativeID`, `accessibilityLabel` and the other `ViewProps` | Go to the native view |

**Ref methods:** `goBack`, `goForward`, `reload` (retries the failed URL after an error), `stopLoading`, `evaluate(expression)`, `getUrl()` (the same `url` as the navigation state), `get(key)` and `call(method, args?, options?)` (see [Platform settings](#platform-settings)).

`evaluate` runs an expression (not statements) in the main frame and awaits a returned Promise. The value comes back through JSON, so what JSON can't encode (a function, `NaN`, a cycle) gives `null` and a `Date` gives its ISO string. A throw or rejection rejects with code `ERR_EVALUATE`. If the page navigates before the script finishes, it rejects (Android code `navigated`, iOS `ERR_EVALUATE`) instead of waiting forever. The result is whatever the page's own JS returns, so treat it as page data. On Android the result comes back through a `window.nativeEvaluateResult` object that pages and their frames get; only the main frame's replies count, and a page can forge one only for a value it could already control.

### Loading and error screens

There is no `renderLoading` or `renderError`: the navigation state and `onError` give the same screens in a few
lines, under your own layout.

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

An HTTP error status (404, 503) is not a failed load: the site's own error page shows, and `onHttpError` fires.

## Platform settings

The `userAgent` prop is the only setting the package knows by name. Its other defaults are plain keys your own
override: no script-opened windows (`javaScriptCanOpenWindowsAutomatically`, in `ios.preferences` and
`android.settings`), playback only on a gesture (`ios.configuration.mediaTypesRequiringUserActionForPlayback`,
`android.settings.mediaPlaybackRequiresUserGesture`) and debugging in `__DEV__` only (`ios.webView.inspectable`,
`android.webView.webContentsDebuggingEnabled`, which is process-wide). Everything else the platform offers is reachable
by its own name, without a change to this package, through `ios` and `android`:

```tsx
<WebView
  ios={{
    configuration: { dataDetectorTypes: WK.DataDetectorTypes.link, websiteDataStore: 'nonPersistent' }, // WKWebViewConfiguration: read once, at creation
    preferences: { minimumFontSize: 12 },                                        // WKPreferences
    webpagePreferences: { allowsContentJavaScript: false },                      // WKWebpagePreferences, from the next navigation
    webView: { allowsBackForwardNavigationGestures: true },                      // WKWebView
    scrollView: { bounces: false, contentInsetAdjustmentBehavior: WK.ContentInsetAdjustmentBehavior.never }, // its UIScrollView
  }}
  android={{
    settings: { textZoom: 120, algorithmicDarkeningAllowed: true }, // WebSettings, then WebSettingsCompat
    webView: { overScrollMode: 2, acceptThirdPartyCookies: true },   // WebView, then WebViewCompat, then CookieManager
  }}
/>
const bounces = await ref.current?.get('scrollView.bounces'); // iOS; 'settings.textZoom' on Android
await ref.current?.call('webView.clearCache', [true]);         // a public method; iOS takes a selector, see call below
```

- **The keys autocomplete**, with their type and `@since`, from the SDK headers (`src/platform.generated.ts`), and the
  platforms' enums and constants come as `WK` (`WK.DataDetectorTypes.link`, `WK.ContentMode.desktop`) and `Android`
  (`Android.WebSettings.LOAD_NO_CACHE`). A key the headers don't list, from a newer SDK, still type-checks.
- **Names are the platform's.** iOS keys are Objective-C property names (`inspectable`, `scrollEnabled`), set with
  Key-Value Coding. Android keys are setter names without `set` (`textZoom` for `setTextZoom`), found by reflection,
  with the `WebSettingsCompat` and `WebViewCompat` statics as fallbacks, so an androidx.webkit feature works the day it
  ships. Enums and option sets are their raw numbers; iOS structs are objects (`contentInset: { top, left, bottom, right }`).
- **Only public API.** A key must name a public property or setter that takes the value's type; a private
  (underscore) one is refused. Anything else is skipped with a warning naming the key and the reason, including a
  compat feature this device's WebView lacks. Nothing in this channel can crash the app: a value that doesn't fit the
  property's type never reaches it.
- **Live, except `ios.configuration`**, which WebKit reads once when the WebView is created: a change recreates the
  WebView (the page reloads), as a change of `bridge` or `nativeOptions` does. A key you remove is not reset; set the
  default yourself.
- **`get(key)`** reads a value back through JSON (`ERR_NATIVE` if it can't); on iOS `websiteDataStore` and
  `httpCookieStore` are roots too, on Android `cookieManager` and `webStorage`. **`call`** is below.
- The security defaults below are only defaults: `android.settings.allowFileAccess` or
  `ios.webpagePreferences.allowsContentJavaScript` change them, on your responsibility.

### call

`call(method, args?, options?)` calls a platform method, `root.method`, and resolves with its result through JSON
(`ERR_NATIVE` for one it refuses or that fails). Android: a public method of `webView` (then `WebViewCompat`'s
statics), `cookieManager` or `webStorage`:

```ts
await ref.call('webView.clearCache', [true]);
await ref.call('cookieManager.removeAllCookies', [null]);
await ref.call('webStorage.deleteAllData');
```

iOS: an Objective-C selector on a settings root, `websiteDataStore` or `httpCookieStore`, the arguments set by the
method's signature: booleans, numbers, strings, the four structs as objects, `null` for nil, and `{ set: [...] }`,
`{ date: seconds }` or `{ data: base64 }` for an NSSet, NSDate or NSData. A selector that ends in a completion handler
needs the handler's shape in `options.completion`:

| `completion` | The handler | Resolves with |
|---|---|---|
| `'void'` | `(void)` | `null` |
| `'value'` | `(id)` | the value |
| `'valueError'` | `(id, NSError *)` | the value, or rejects with the error |
| `'error'` | `(NSError *)` | `null`, or rejects with the error |

```ts
await ref.call(
  'websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:',
  [{ set: [WK.WebsiteDataType.cookies, WK.WebsiteDataType.localStorage] }, { date: 0 }],
  { completion: 'void' }
);
const pdf = await ref.call('webView.createPDFWithConfiguration:completionHandler:', [null], { completion: 'valueError' }); // base64
const png = await ref.call('webView.takeSnapshotWithConfiguration:completionHandler:', [null], { completion: 'valueError' }); // base64 PNG
await ref.call('scrollView.setContentOffset:animated:', [{ x: 0, y: 200 }, true]);
```

Results come back through JSON: numbers, strings, an `NSURL` as a string, an `NSDate` as seconds, `NSData` as base64,
a `UIImage` as a base64 PNG, the four structs as objects, and arrays, sets and dictionaries of them; any other object
is `null`. Refused with `ERR_NATIVE`: what the core owns (on iOS every selector that loads, navigates, runs a script,
starts a download or sets a delegate; on Android the loads, clients, `destroy` and `evaluateJavascript`), private
(`_`) selectors and KVC, as well as an unknown selector, a wrong argument count and an argument that doesn't fit the
signature. Two things the signature can't check are undefined behaviour and crash the app: a wrong completion shape,
and an object argument of the wrong class. For a method that takes an object, write a [native hook](#native-hooks).

## Page requests

The page asks for things only the app can answer. Each request works without its prop. Passing the prop takes the
request over: to decide, to use your own picker, or to observe it.

| The page | Default (no prop) | Prop | Typical packages |
|---|---|---|---|
| `<input type="file">` | iOS: WebKit's picker (needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`). Android: the system file chooser; it ignores `capture` | `onFileRequest({ accept, multiple, capture })` (Android only) returns URIs, or `null` to cancel | expo-document-picker, expo-image-picker |
| Fullscreen video | iOS: WebKit's. Android: the page's fullscreen view covers the WebView's window on black, system bars hide, and back exits | `onFullscreenChange({ active })` (Android only) | expo-screen-orientation |
| Camera, microphone, (Android) location and protected media | Android: denied. iOS: WebKit's own prompt (location always prompts; FairPlay asks nothing) | `onPermissionRequest({ origin, resources })` answers `true` or `false`. Main frame only: other frames are denied without asking. `protectedMedia` is the device id DRM (Widevine) playback needs | expo-camera, expo-audio, expo-location |
| A download | http(s): opens externally (`onOpenExternal`, or the system browser, which fetches it without the page's session; reported to `onNavigation` as `external`). `data:` and `blob:`: dropped | `onDownload(result)`: a [file in the app's cache](#downloads), or a failure | expo-file-system, expo-sharing |
| HTTP basic or digest auth | Cancelled: the site's 401 page shows | `onHttpAuthRequest({ host, realm })` returns `{ username, password }`, or `null` to cancel | expo-secure-store |

`onPermissionRequest` never makes the OS prompt: the app asks the OS (expo-camera, expo-location), and without OS
permission the page's request fails anyway (`NotReadableError`, geolocation code 2 or 3). On iOS, `true` skips WebKit's
own prompt. Android's WebView keeps a location answer until the page changes.

An unanswered request is cancelled when its page is replaced (navigation, reload, unmount). Until then, a handler that
never settles blocks that page's further requests of the same kind.

A [native hook](#native-hooks) whose delegate or client takes the same platform callback comes before these props.

### Downloads

With `onDownload`, the core saves the file: `WKDownload` on iOS (the page's session) into the temporary directory; on
Android it is fetched again with the page's cookies and user agent into the cache, `data:` and `blob:` too. A POST
body, the `headers` prop and `onHttpAuthRequest` credentials don't go with an Android fetch, so such a download can fail
or save the wrong file (a login page). The result is `{ uri, filename, mimeType, url }` with a `file://` `uri`, or
`{ filename, url, reason }` when it failed: `'uri' in result` tells them apart. `url` is the server URL the file came
from; `null` when the page generated it (`data:` or `blob:` URL).

### Recipes

File upload with expo-document-picker, or expo-image-picker for photos and the camera:

```tsx
<WebView
  onFileRequest={async ({ accept, multiple }) => {
    const mimeTypes = accept.filter((type) => type.includes('/')); // the picker takes MIME types, not `.pdf`
    const result = await DocumentPicker.getDocumentAsync({ type: mimeTypes.length ? mimeTypes : '*/*', multiple });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  }}
/>
```

```tsx
onFileRequest={async ({ multiple, capture }) => {
  const pick = capture ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await pick({ allowsMultipleSelection: multiple });
  return result.canceled ? null : result.assets.map((asset) => asset.uri);
}}
```

Camera for one site, with expo-camera:

```tsx
onPermissionRequest={async ({ origin, resources }) => {
  if (origin !== 'https://meet.example.com' || !resources.every((resource) => resource === 'camera')) return false;
  return (await Camera.requestCameraPermissionsAsync()).granted;
}}
```

Let a portrait-locked app rotate while a video is fullscreen (Android), with expo-screen-orientation:

```tsx
onFullscreenChange={({ active }) =>
  active ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
}
```

A download is a file in the app's cache. The app opens, saves or shares it, with expo-file-system and expo-sharing:

```tsx
// Open it: Quick Look on iOS, an app for the MIME type on Android.
onDownload={(result) => 'uri' in result && new File(result.uri).preview()}

// Save it where the user chooses: a folder pick on Android, the share sheet's "Save to Files" on iOS.
onDownload={async (result) => {
  if (!('uri' in result)) return console.warn('download failed', result.reason);
  if (Platform.OS === 'ios') return Sharing.shareAsync(result.uri);
  const target = (await Directory.pickDirectoryAsync()).createFile(result.filename, result.mimeType);
  await target.write(await new File(result.uri).bytes());
}}

// Share it.
onDownload={(result) => 'uri' in result && Sharing.shareAsync(result.uri)}
```

## Native hooks

Anything the settings can't express is a few lines of Swift or Kotlin in your own Expo module (a
[local module](https://docs.expo.dev/modules/get-started/) in `modules/`, or a package). There is no protocol to
implement: a hook gets the real `WKWebView` or `WebView` and its creation-time configuration, and can chain its own
delegates and clients. `example/modules/sample-extension` is a complete one.

```swift
// iOS, in your module's OnCreate: a hook under the nativeOptions key that enables it
MinimalWebViewHooks.configure["pageCounter"] = { configuration, context in   // before the WKWebView exists
  configuration.dataDetectorTypes = .phoneNumber
}
MinimalWebViewHooks.attach["pageCounter"] = { webView, context in             // once it exists; return a detach closure or nil
  context.navigationDelegates.append(PageCounter(context: context))
  return nil
}
```

```kotlin
// Android, in your module's OnCreate
MinimalWebViewHooks.attach["pageCounter"] = { webView, context ->             // for each WebView: the first, and any after a crash
  context.clients += PageCounter(context)  // a WebViewClient
  null
}
```

```tsx
<WebView nativeOptions={{ pageCounter: true }} onNativeEvent={({ name, payload }) => … } />  // name: 'pageCounter.pageLoaded'
```

- **`nativeOptions`** enables hooks: a hook runs for a WebView whose `nativeOptions` has its key, and `context.options`
  is the whole prop, so the key's value can configure it. Read when the WebView is created, like `bridge`: a change
  recreates it.
  Keys are global, and a later registration under the same key silently replaces the earlier one: a package should
  prefix its keys with its name (`myPackage.pageCounter`).
- **Delegates and clients.** A callback the core doesn't implement goes to the first of your delegates (clients) that
  does. A decision callback the core implements goes to the first of yours that does, and the core steps aside: on iOS
  navigation and response policy, authentication, a new window, JS dialogs and media capture; on Android
  `shouldOverrideUrlLoading`, HTTP auth, SSL errors, permissions, geolocation, fullscreen, a new window and the file
  chooser. An observation callback the core implements reaches the core first, then every one of yours. So a client
  that overrides `shouldOverrideUrlLoading` switches the navigation rules off for that WebView, and one that overrides
  `onPageFinished` is just told. Android's `shouldInterceptRequest` runs on a background thread, as always. A client may extend `WebViewClientCompat`:
  overriding its `onReceivedError`, `onSafeBrowsingHit` or `shouldOverrideUrlLoading(WebView, String)` variant counts as
  overriding the platform callback that forwards to it.
- **Events.** `context.emit(name, payload)` sends `onNativeEvent({ name: '<hook>.<name>', payload })`: the hook's key
  is the prefix, so names never collide with the package's (`core.`) or another hook's. `context.ask(name, payload) { answer in … }`
  waits for the handler's return value (a promise is awaited; a throw or no handler answers null).
- **Lifecycle.** `configure` runs after the `ios.configuration` settings and before the bridge, so replacing the
  user content controller is fine. `attach` runs once the WebView exists (on Android also for the new WebView after a
  renderer crash); the closure it returns runs when that WebView goes away. Everything runs on the main thread. Set
  delegates in `attach`: WebKit reads what a delegate responds to when it is assigned, and the core re-assigns itself
  after each change to the lists.
- **What not to touch:** the WebView's own delegate and client slots (use the lists), the bridge's script message
  handler and user scripts, and Android's download listener. `MinimalWebViewHooks.webViewClass` (iOS) and
  `webViewFactory` (Android) let a subclass override what the platform class allows.

## Security defaults

- File access is off, mixed content is never allowed, and SSL errors are always cancelled.
- There is no `addJavascriptInterface`. Android pages see one extra global, `nativeEvaluateResult`, for `evaluate` results.
- A page can open a window only from a tap, unless the `javaScriptCanOpenWindowsAutomatically` setting is on. The navigation rules decide every new window.
- The bridge works only for allowed origins, main frame only.
- `intent:` URLs are sanitised.
- Camera, microphone, location and protected media are granted only when `onPermissionRequest` says so, to the main frame only. Without it, Android denies and iOS shows WebKit's prompt.
- Download filenames are sanitised.
- Debugging is on only in `__DEV__`.

## Development

```sh
npm install && (cd example && npm install)
npm test                                   # TS unit tests (bridge protocol, createBridge, origin matchers)
npm run check:pack                         # clean build; fails if a packed build/ file imports one the package leaves out
(cd example/android && ./gradlew :minimal-rn-webview:testDebugUnitTest)   # Kotlin rule and origin matchers
xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules
cd example && npm run test-pages           # local test pages on :8090
npx expo run:android | npx expo run:ios
example/maestro/run.sh android emulator-5554          # on-device suites through Maestro (all, or name some)
example/maestro/run.sh ios <simulator udid> ptr dialogs
```

The on-device suites (`example/harness.ts`) run inside the example app and make every WebView assertion there.
[Maestro](https://maestro.dev) only drives them: each flow in `example/maestro/` starts a suite, performs the
gestures, taps, dialog presses and renderer kills the suite asks for (shown on screen as `<suite>#<n> <REQUEST>`),
and fails unless the suite ends with `fail=0`. A suite can also be started by hand with
`curl 'localhost:8090/harness/run?platform=android&suite=urlTracking'`. Renderer kills on Android need `adb root`.
