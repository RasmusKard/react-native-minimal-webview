# minimal-rn-webview

A small, extensible WebView for React Native, built with the Expo Modules API (Swift and Kotlin), for the new architecture only.

- **Native decides, JS is told.**
  - Navigation rules run natively: no JS round trip per navigation, and the UI thread never blocks.
  - Only three hooks can change an outcome: `onNavigationRequest`, plus `onPermissionRequest` and `onFileRequest` in their extensions. Each has a safe default.
- **One committed URL, owned by native.** `useWebViewState(ref)` gives `url`, `pendingUrl`, `title`, `loading`, `progress`, `canGoBack` and `canGoForward`. `url` is the page on screen: it changes when a load commits and on SPA navigation (pushState, replaceState, hash), and stays the old page while a load is in progress. After a failed load it is the failed URL. `pendingUrl` is a main-frame load in progress, which may still fail or be blocked. Iframes never change either.
- **A promise bridge** between React Native and the page, restricted to the origins you allow.
- **Opt-in extensions:** pull-to-refresh, fullscreen video, file upload, downloads, permissions and shared cookies. They are built on the same interface third parties use.
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
const info = WebView.getAndroidWebViewInfo(); // null on iOS
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
        { scheme: ['tel', 'mailto', 'sms'], action: 'external' },
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

## Navigation rules

Rules are an ordered list, and the first match wins. Every field a rule sets must match:

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
- `ask`: call `onNavigationRequest`, which answers `allow`, `block` or `external` within 1 s. A late or missing answer counts as `block`.

**Defaults:**
- With no rules, http(s) loads in place, `file:` is blocked and every other scheme opens externally.
- With rules but no match, the result is `block`.
- `about:`, `blob:`, `data:` and `javascript:` always load.

`onNavigation` reports every decision: `{ url, action, mainFrame, newWindow, userInitiated, rule }`.

**Platform differences:**
- **`ask` on Android.** Android can't pause a navigation, so `ask` cancels it, asks, and reissues it with `loadUrl` on `allow`. The reissued load loses the referrer and the gesture flag, and its redirect chain restarts. `ask` works only for the main frame on Android; for iframes it falls back to `block`. iOS holds the navigation and asks for any frame.
- **POST on Android.** Android never runs the rules for POST requests: form posts and payment redirects always load.
- **POST into a new window on Android.** A form POST to `target=_blank` can't be captured, so it doesn't load; iOS loads it in place.
- **iframes on Android.** Android only decides iframe navigations to non-http(s) schemes (`tel:`, `intent:` and so on). Rules for http(s) iframes, the `mainFrame: false` ones, apply only on iOS.
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
- **Errors are structured:** `{ code, message }`. The codes are `timeout`, `not_found`, `handler_error`, `navigated`, `unavailable` (an Android System WebView without the bridge's features; see Requirements), `invalid` and `too_large`.
- **Timeouts:** calls time out after 10 s by default (`timeoutMs`).
- **Navigation:** calls in flight are rejected with `navigated` when the page navigates or the WebView unmounts.
- **Origins:** pages outside `allowedOrigins` get no `window.nativeBridge`, and nothing is delivered to them. Only the main frame takes part. A rule is `*` (any origin, opaque ones too), `https://example.com[:port]`, `https://*.example.com[:port]` (subdomains only, not `example.com`) or an IP literal such as `http://[::1]:8080`; http or https only, no path, ASCII (punycode) hosts. Case is ignored, and a missing port means 80 or 443. The `permissions` extension's `origins` match the same way. One file of test cases (`test-vectors/origin-rules.json`) checks every matcher.
- **Transports:** iOS uses `WKScriptMessageHandlerWithReply` plus `callAsyncJavaScript`; Android uses `addWebMessageListener` with origin rules.

Build your own page APIs on top of it, for example an injected `window.MyAppAPI` that calls the bridge.

### Web content written for react-native-webview

Pages that call `window.ReactNativeWebView.postMessage(string)` and listen for `message` events keep working through
the bridge. Only `allowedOrigins` get `ReactNativeWebView`, where react-native-webview gives it to every page.

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
| `userAgent` / `applicationNameForUserAgent` | Replace the user agent, or append to the default one. On iOS the app name is fixed at creation: changing it recreates the WebView |
| `injectedScripts` | `[{ code, when: 'start' \| 'end', mainFrameOnly? }]`. Changes apply from the next navigation. On Android, `'end'` scripts need System WebView 146+ (see Requirements) |
| `navigationRules`, `onNavigationRequest`, `onNavigation`, `onOpenExternal` | See above |
| `bridge` | `createBridge(...)`. Fixed at mount: remount with a new `key` to change it |
| `thirdPartyCookiesEnabled` | Android only, default false. WebKit always blocks third-party cookies (as Safari does) |
| `mediaPlaybackRequiresUserAction` (default true), `allowsInlineMediaPlayback` (iOS, default false) | Fixed at creation on iOS |
| `scrollEnabled`, `bounces` | iOS only |
| `showsScrollIndicators` | |
| `javaScriptCanOpenWindowsAutomatically` | Default false: only a tap opens a window (`target=_blank`, `window.open` in a click handler). Set it for a page that opens one by itself, like an OAuth popup after an `await`. The navigation rules decide either way (`newWindow: true`) |
| `webviewDebuggingEnabled` | Default `__DEV__`. Process-wide on Android |
| `extensions` | See below. Fixed at mount, like `bridge`; their handlers stay live |
| `renderLoading`, `renderError` | Overlays that cover the WebView while loading, or after a main-frame network or SSL error until the next load. An HTTP error page (404, 503) is shown as the site sent it, and reported in `onError` |
| `onNavigationStateChange`, `onLoadStart`, `onLoad`, `onLoadEnd` | `onLoad` doesn't fire for a failed load |
| `onError` | `{ kind: 'network' \| 'http' \| 'ssl', url, code, description }`. Main-frame errors only. SSL errors are always cancelled |
| `onProcessGone` | `{ didCrash, recovered }`. The core has already reloaded the page; after more than 3 crashes in 60 s it stops reloading until the next `source` change |
| `style`, `testID`, `nativeID`, `accessibilityLabel` and the other `ViewProps` | Go to the outermost view: the native view, or the container when `renderLoading` or `renderError` is set |

**Ref methods:** `goBack`, `goForward`, `reload` (retries the failed URL after an error), `stopLoading`, `evaluate(expression)`, `getUrl()` (the same `url` as the navigation state).

`evaluate` runs an expression (not statements) in the main frame and awaits a returned Promise. The value comes back through JSON, so what JSON can't encode (a function, `NaN`, a cycle) gives `null` and a `Date` gives its ISO string. A throw or rejection rejects with code `ERR_EVALUATE`. If the page navigates before the script finishes, it rejects (Android code `navigated`, iOS `ERR_EVALUATE`) instead of waiting forever. The result is whatever the page's own JS returns, so treat it as page data. On Android the result comes back through a `window.nativeEvaluateResult` object that pages and their frames get; only the main frame's replies count, and a page can forge one only for a value it could already control.

## Extensions

```tsx
<WebView
  extensions={[
    pullToRefresh(),
    fullscreenVideo(),
    fileUpload({ onFileRequest }),
    downloads({ onDownload }),
    permissions({ origins: ['https://*.example.com'], onPermissionRequest }),
    sharedCookies(),
    httpAuth({ onAuthRequest }),
  ]}
/>
```

| Extension | iOS | Android |
|---|---|---|
| `pullToRefresh()` | `UIRefreshControl` | `SwipeRefreshLayout`. A pull inside a scrolled inner scroller (`overflow: auto`) scrolls it instead of reloading |
| `fullscreenVideo({ onChange })` | Built in (WebKit) | The page's fullscreen view covers the WebView's window (so it works inside a `Modal`) on black, system bars hide, and back exits. `onChange(active)` reports it |
| `fileUpload({ onFileRequest })` | Built in (WebKit's picker; needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`) | `onFileRequest({ accept, multiple, capture })` returns URIs, or `null` to cancel. Without the extension, file inputs open nothing |
| `downloads({ onDownload, onError? })` | `WKDownload` (the page's session) into the temporary directory | Fetched again with the page's cookies and user agent into the cache; `data:` and `blob:` too. A POST body, the `headers` prop and `httpAuth` credentials don't go with it, so such a download can fail or save the wrong file (a login page). `onDownload` gets a `file://` on both platforms, `onError({ filename, url, reason })` |
| `permissions({ origins, onPermissionRequest? })` | WebKit asks the OS. `true` skips WebKit's own prompt; other origins are denied | Grants what `onPermissionRequest` answers; without it, listed origins are granted. Never prompts: the app asks the OS (expo-camera, expo-location), and without OS permission the page's request fails (`NotReadableError`, geolocation code 2 or 3). WebView keeps a location answer until the page changes |
| `sharedCookies()` | Copies `HTTPCookieStorage` into the WebView before each `source` load (the first load waits for it), and the WebView's cookie changes back as they happen | Built in (`CookieManager` is app-wide, flushed when the app backgrounds) |
| `httpAuth({ onAuthRequest })` | `onAuthRequest({ host, realm })` returns `{ username, password }`, or `null` to cancel | The same. Without the extension, auth challenges are cancelled and the site's 401 page shows |

### Recipes

File upload with expo-document-picker, or expo-image-picker for photos and the camera:

```tsx
fileUpload({
  onFileRequest: async ({ accept, multiple }) => {
    const mimeTypes = accept.filter((type) => type.includes('/')); // the picker takes MIME types, not `.pdf`
    const result = await DocumentPicker.getDocumentAsync({ type: mimeTypes.length ? mimeTypes : '*/*', multiple });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  },
});
```

```tsx
fileUpload({
  onFileRequest: async ({ accept, multiple, capture }) => {
    const pick = capture ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await pick({ allowsMultipleSelection: multiple });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  },
});
```

Camera permission with expo-camera:

```tsx
permissions({
  origins: ['https://meet.example.com'],
  onPermissionRequest: async ({ resources }) => {
    if (resources.includes('camera')) return (await Camera.requestCameraPermissionsAsync()).granted;
    return false;
  },
});
```

Let a portrait-locked app rotate while a video is fullscreen (Android), with expo-screen-orientation:

```tsx
fullscreenVideo({
  onChange: (active) =>
    active ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP),
});
```

A download is a file in the app's cache. The app opens, saves or shares it, with expo-file-system and expo-sharing:

```tsx
// Open it: Quick Look on iOS, an app for the MIME type on Android.
downloads({ onDownload: ({ uri }) => new File(uri).preview() });

// Save it where the user chooses: a folder pick on Android, the share sheet's "Save to Files" on iOS.
downloads({
  onDownload: async ({ uri, filename, mimeType }) => {
    if (Platform.OS === 'ios') return Sharing.shareAsync(uri);
    const target = (await Directory.pickDirectoryAsync()).createFile(filename, mimeType);
    await target.write(await new File(uri).bytes());
  },
});

// Share it.
downloads({ onDownload: ({ uri }) => Sharing.shareAsync(uri) });
```

### Writing an extension

An extension is native code registered by name, plus an optional JS helper. `example/modules/sample-extension` is a complete one that lives outside the package.

```kotlin
// Android: in your Expo module's OnCreate
WebViewExtensions.register("pageCounter") { PageCounter() }

class PageCounter : WebViewExtension {
  private lateinit var host: ExtensionHost
  override fun onAttach(host: ExtensionHost, config: Map<String, Any?>) { this.host = host }
  override fun onPageFinished(url: String) = host.emit("pageLoaded", mapOf("url" to url))
}
```

```swift
// iOS: in your Expo module's OnCreate
WebViewExtensions.register("pageCounter") { PageCounter() }

final class PageCounter: WebViewExtension {
  private var host: ExtensionHost?  // keep it strong; it holds the view weakly
  func attach(host: ExtensionHost, config: [String: Any]) { self.host = host }
  func didFinish(url: URL?) { host?.emit("pageLoaded", ["url": url?.absoluteString ?? ""]) }
}
```

```ts
export const pageCounter = (): WebViewExtension => ({
  native: { name: 'pageCounter', config: {} },
  on: { pageLoaded: ({ url }: { url: string }) => console.log('loaded', url) },
});
```

**The hooks:**
- Android: `wrap` (container), `onPageFinished`, `onShowFileChooser`, `onPermissionRequest`, `onGeolocationPrompt`, `onShowCustomView`/`onHideCustomView`, `onDownloadStart`, `onHttpAuthRequest` and `onDetach`. The host gives `webView`, `activity`, `emit`, `ask`, `handles` and `evaluate`.
- iOS: `didCreate`, `prepare`, `didFinish`, `decidePolicy(for:)`, `wantsDownload`, `didBecome(download)`, `requestMediaCapture`, `authenticate` and `detach`. The host gives `webView`, `emit`, `ask`, `handles` and `reload`.
- **Decide hooks:** the first extension that handles one wins.
- **`ask`:** sends an event to the helper's handler for it in `on` and passes its return value back to native. `handles(event)` says whether the helper has one, so native can fall back to a default without it.

The interface is **experimental** until it has had more outside users.

## Security defaults

- File access is off, mixed content is never allowed, and SSL errors are always cancelled.
- There is no `addJavascriptInterface`. Android pages see one extra global, `nativeEvaluateResult`, for `evaluate` results.
- A page can open a window only from a tap, unless `javaScriptCanOpenWindowsAutomatically` is set. The navigation rules decide every new window.
- The bridge works only for allowed origins, main frame only.
- `intent:` URLs are sanitised.
- Permissions are granted only to configured origins in the main frame, and are denied by default.
- Download filenames are sanitised.
- Debugging is on only in `__DEV__`.

## Development

```sh
npm install && (cd example && npm install)
npm test                                   # TS unit tests (bridge protocol, createBridge, origin matchers)
npm run check:pack                         # clean build; fails if a packed build/ file imports one the package leaves out
(cd example/android && ./gradlew :minimal-rn-webview:testDebugUnitTest)   # Kotlin rule and origin matchers
xcrun swiftc ios/NavigationRules.swift ios/OriginRules.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules test-vectors/navigation-rules.json test-vectors/origin-rules.json
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
