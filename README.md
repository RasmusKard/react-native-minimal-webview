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
      applicationNameForUserAgent="MyApp/1.0"
      navigationRules={[
        { scheme: ['tel', 'mailto', 'sms'], mainFrame: true, action: 'external' },
        { host: ['example.com', '*.example.com'], action: 'allow' },
        { newWindow: true, action: 'external' },
        { scheme: ['http', 'https'], mainFrame: false, action: 'allow' },
        { scheme: ['http', 'https'], action: 'external' },
      ]}
      renderError={(error) => <OfflineScreen error={error} onRetry={() => ref.current?.reload()} />}
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
- With no rules, http(s) loads in place, `file:` is blocked and every other scheme opens externally from the main frame. A subframe's navigation to one is blocked. A new window counts as a main-frame navigation, so a tap in an iframe that runs `window.open('myapp://…')` still opens externally; without `javaScriptCanOpenWindowsAutomatically`, only a tap opens a window.
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
const bridge = useMemo(() => {
  const b = createBridge({ allowedOrigins: ['https://example.com', 'https://*.example.com'] });
  b.handle('share', async ({ url }) => { await Share.share({ url }); return true });
  return b;
}, []);

<WebView bridge={bridge} … />
await bridge.call('getCartCount');   // a method the page registered
bridge.emit('themeChanged', 'dark');
```

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

## Props

| Prop | Notes |
|---|---|
| `source` | `{ uri, headers? }` or `{ html, baseUrl? }`. `headers` go on the first request only |
| `ios`, `android` | Any WebKit property or Android setter, by name. See [Platform settings](#platform-settings) |
| `userAgent` / `applicationNameForUserAgent` | Replace the user agent, or append to the default one. The app name is fixed at mount: remount with a new `key` to change it |
| `injectedScripts` | `[{ code, when: 'start' \| 'end', mainFrameOnly? }]`. Changes apply from the next navigation. On Android, `'end'` scripts need System WebView 146+ (see Requirements) |
| `navigationRules`, `onNavigationRequest`, `onNavigation`, `onOpenExternal` | See above |
| `bridge` | `createBridge(...)`. Fixed at mount: remount with a new `key` to change it |
| `pullToRefresh` | Pull down at the top of the page to reload: `UIRefreshControl`, or `SwipeRefreshLayout` (a pull inside a scrolled inner scroller, `overflow: auto`, scrolls it instead) |
| `sharedCookies` | iOS: copies `HTTPCookieStorage` into the WebView before each `source` load (the first load waits for it), and the WebView's cookie changes back as they happen. Android needs nothing: `CookieManager` is app-wide, flushed when the app backgrounds |
| `mediaPlaybackRequiresUserAction` | Default true. Fixed at mount, like `bridge`: remount with a new `key` to change it |
| `javaScriptCanOpenWindowsAutomatically` | Default false: only a tap opens a window (`target=_blank`, `window.open` in a click handler). Set it for a page that opens one by itself, like an OAuth popup after an `await`. The navigation rules decide either way (`newWindow: true`) |
| `webviewDebuggingEnabled` | Default `__DEV__`. Process-wide on Android |
| `onFileRequest`, `onFullscreenChange`, `onPermissionRequest`, `onDownload`, `onHttpAuthRequest` | See [Page requests](#page-requests). They can be added and removed at any time |
| `nativeOptions`, `onNativeEvent` | What your [native hooks](#native-hooks) get, and what they send. `nativeOptions` is fixed at mount, like `bridge` |
| `renderLoading`, `renderError` | Overlays that cover the WebView while loading, or after a main-frame network or SSL error until the next load. An HTTP error page (404, 503) is shown as the site sent it, and reported in `onHttpError` |
| `onNavigationStateChange`, `onLoadStart`, `onLoad`, `onLoadEnd` | `onLoad` doesn't fire for a failed load |
| `onError` | `{ kind: 'network' \| 'ssl', url, code, description }`: the load failed. Main-frame errors only. SSL errors are always cancelled |
| `onHttpError` | `{ url, statusCode, description }`: the main frame got an HTTP error status (400+), and the site's own error page shows |
| `onProcessGone` | `{ didCrash, recovered }`. The core has already reloaded the page; after more than 3 crashes in 60 s it stops reloading until the next `source` change |
| `style`, `testID`, `nativeID`, `accessibilityLabel` and the other `ViewProps` | Go to the outermost view: the native view, or the container when `renderLoading` or `renderError` is set |

**Ref methods:** `goBack`, `goForward`, `reload` (retries the failed URL after an error), `stopLoading`, `evaluate(expression)`, `getUrl()` (the same `url` as the navigation state), `get(key)` and `call(method, ...args)` (see [Platform settings](#platform-settings)).

`evaluate` runs an expression (not statements) in the main frame and awaits a returned Promise. The value comes back through JSON, so what JSON can't encode (a function, `NaN`, a cycle) gives `null` and a `Date` gives its ISO string. A throw or rejection rejects with code `ERR_EVALUATE`. If the page navigates before the script finishes, it rejects (Android code `navigated`, iOS `ERR_EVALUATE`) instead of waiting forever. The result is whatever the page's own JS returns, so treat it as page data. On Android the result comes back through a `window.nativeEvaluateResult` object that pages and their frames get; only the main frame's replies count, and a page can forge one only for a value it could already control.

## Platform settings

The four cross-platform props above are the only settings the package knows by name. Everything else the platform
offers is reachable by its own name, without a change to this package, through `ios` and `android`:

```tsx
<WebView
  ios={{
    configuration: { dataDetectorTypes: 1, websiteDataStore: 'nonPersistent' }, // WKWebViewConfiguration: read once, at creation
    preferences: { minimumFontSize: 12 },                                        // WKPreferences
    webpagePreferences: { allowsContentJavaScript: false },                      // WKWebpagePreferences, from the next navigation
    webView: { allowsBackForwardNavigationGestures: true },                      // WKWebView
    scrollView: { bounces: false, contentInsetAdjustmentBehavior: 2 },           // its UIScrollView
  }}
  android={{
    settings: { textZoom: 120, algorithmicDarkeningAllowed: true }, // WebSettings, then WebSettingsCompat
    webView: { overScrollMode: 2, acceptThirdPartyCookies: true },   // WebView, then WebViewCompat, then CookieManager
  }}
/>
const bounces = await ref.current?.get('scrollView.bounces'); // iOS; 'settings.textZoom' on Android
await ref.current?.call('clearCache', true);                   // Android: a public WebView method
```

- **Names are the platform's.** iOS keys are Objective-C property names (`inspectable`, `scrollEnabled`), set with
  Key-Value Coding. Android keys are setter names without `set` (`textZoom` for `setTextZoom`), found by reflection,
  with the `WebSettingsCompat` and `WebViewCompat` statics as fallbacks, so an androidx.webkit feature works the day it
  ships. Enums and option sets are their raw numbers; iOS structs are objects (`contentInset: { top, left, bottom, right }`).
- **Only public API.** A key must name a public property or setter that takes the value's type; a private
  (underscore) one is refused. Anything else is skipped with a warning naming the key and the reason, including a
  compat feature this device's WebView lacks. Nothing in this channel can crash the app: a value that doesn't fit the
  property's type never reaches it.
- **Live, except `ios.configuration`**, which WebKit reads once when the WebView is created: a later change warns, and
  a remount with a new `key` applies it. A key you remove is not reset; set the default yourself.
- **`get(key)`** reads a value back through JSON (`ERR_NATIVE` if it can't). **`call(method, ...args)`** calls a
  public `WebView` method on Android and resolves with its result; the methods the core owns (loads, clients,
  `destroy`, `evaluateJavascript`) are refused. On iOS it rejects with `unavailable`: call WebKit from a native hook.
- The security defaults below are only defaults: `android.settings.allowFileAccess` or
  `ios.webpagePreferences.allowsContentJavaScript` change them, on your responsibility.

## Page requests

The page asks for things only the app can answer. Each request works without its prop. Passing the prop takes the
request over: to decide, to use your own picker, or to observe it.

| The page | Default (no prop) | Prop | Typical packages |
|---|---|---|---|
| `<input type="file">` | iOS: WebKit's picker (needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`). Android: the system file chooser; it ignores `capture` | `onFileRequest({ accept, multiple, capture })` (Android only) returns URIs, or `null` to cancel | expo-document-picker, expo-image-picker |
| Fullscreen video | iOS: WebKit's. Android: the page's fullscreen view covers the WebView's window on black, system bars hide, and back exits | `onFullscreenChange({ active })` (Android only) | expo-screen-orientation |
| Camera, microphone, (Android) location | Android: denied. iOS: WebKit's own prompt (location always prompts) | `onPermissionRequest({ origin, resources })` answers `true` or `false`. Main frame only: other frames are denied without asking | expo-camera, expo-audio, expo-location |
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
// iOS, in your module's OnCreate
MinimalWebViewHooks.configure.append { configuration, context in   // before the WKWebView exists
  if context.options["pageCounter"] != nil { configuration.dataDetectorTypes = .phoneNumber }
}
MinimalWebViewHooks.attach.append { webView, context in             // once it exists; return a detach closure or nil
  if context.options["pageCounter"] != nil { context.navigationDelegates.append(PageCounter(context: context)) }
  return nil
}
```

```kotlin
// Android, in your module's OnCreate
MinimalWebViewHooks.attach += { webView, context ->                 // for each WebView: the first, and any after a crash
  if (context.options["pageCounter"] != null) context.clients += PageCounter(context)  // a WebViewClient
  null
}
```

```tsx
<WebView nativeOptions={{ pageCounter: true }} onNativeEvent={({ name, payload }) => … } />
```

- **`nativeOptions`** is what every hook gets as `context.options`: how an app enables a hook for one WebView and
  configures it. Fixed at mount, like `bridge`.
- **Delegates and clients.** A callback the core doesn't implement goes to the first of your delegates (clients) that
  does. A decision callback the core implements goes to the first of yours that does, and the core steps aside: on iOS
  navigation and response policy, authentication, a new window, JS dialogs and media capture; on Android
  `shouldOverrideUrlLoading`, HTTP auth, SSL errors, permissions, geolocation, fullscreen, a new window and the file
  chooser. An observation callback the core implements reaches the core first, then every one of yours. So a client
  that overrides `shouldOverrideUrlLoading` switches the navigation rules off for that WebView, and one that overrides
  `onPageFinished` is just told. Android's `shouldInterceptRequest` runs on a background thread, as always.
- **Events.** `context.emit(name, payload)` sends `onNativeEvent({ name, payload })`; `context.ask(name, payload) { answer in … }`
  waits for the handler's return value (a promise is awaited; a throw or no handler answers null). Names starting
  with `core.` are the package's; prefix yours with the hook's name.
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
- A page can open a window only from a tap, unless `javaScriptCanOpenWindowsAutomatically` is set. The navigation rules decide every new window.
- The bridge works only for allowed origins, main frame only.
- `intent:` URLs are sanitised.
- Camera, microphone and location are granted only when `onPermissionRequest` says so, to the main frame only. Without it, Android denies and iOS shows WebKit's prompt.
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
