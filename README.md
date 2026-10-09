# minimal-rn-webview

A small, extensible WebView for React Native, built with the Expo Modules API (Swift and Kotlin), for the new architecture only.

- **Native decides, JS is told.**
  - Navigation rules run natively: no JS round trip per navigation, and the UI thread never blocks.
  - Only three hooks can change an outcome: `onNavigationRequest`, plus `onPermissionRequest` and `onFileRequest` in their extensions. Each has a safe default.
- **One committed URL, owned by native.** `useWebViewState(ref)` gives `url`, `pendingUrl`, `title`, `loading`, `progress`, `canGoBack` and `canGoForward`. SPA navigation (pushState, replaceState, hash) is included; iframes never change it.
- **A promise bridge** between React Native and the page, restricted to the origins you allow.
- **Opt-in extensions:** pull-to-refresh, fullscreen video, file upload, downloads, permissions and shared cookies. They are built on the same interface third parties use.
- **The app owns device APIs.** The library never shows OS permission prompts or pickers itself. It has no config plugin and no dependency on expo-camera, expo-image-picker or similar packages.

**Requirements:**
- iOS 16.4.
- Android API 29+. Set `minSdkVersion 29`, for example with `expo-build-properties`.
- Expo SDK 58 or a bare app with the new architecture.

Some features need Android System WebView 146 or newer; any API 29+ device with updates enabled has it. `WebView.getAndroidWebViewInfo()` reports what the device supports.

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

`decideNavigation(rules, request)` is the same matcher in JS, for unit-testing your rules. One file of test cases checks the Kotlin, Swift and TS matchers alike.

`onNavigation` reports every decision: `{ url, action, mainFrame, newWindow, userInitiated, rule }`.

**Platform differences:**
- **`ask` on Android.** Android can't pause a navigation, so `ask` cancels it, asks, and reissues it with `loadUrl` on `allow`. The reissued load loses the referrer and the gesture flag, and its redirect chain restarts. `ask` works only for the main frame on Android; for iframes it falls back to `block`. iOS holds the navigation and asks for any frame.
- **POST on Android.** Android never runs the rules for POST requests: form posts and payment redirects always load.
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
- **Errors are structured:** `{ code, message }`. The codes are `timeout`, `not_found`, `handler_error`, `navigated`, `unavailable`, `invalid` and `too_large`.
- **Timeouts:** calls time out after 10 s by default (`timeoutMs`).
- **Navigation:** calls in flight are rejected with `navigated` when the page navigates or the WebView unmounts.
- **Origins:** pages outside `allowedOrigins` get no `window.nativeBridge`, and nothing is delivered to them. Only the main frame takes part.
- **Transports:** iOS uses `WKScriptMessageHandlerWithReply` plus `callAsyncJavaScript`; Android uses `addWebMessageListener` with origin rules.

Build your own page APIs on top of it, for example an injected `window.MyAppAPI` that calls the bridge.

## Props

| Prop | Notes |
|---|---|
| `source` | `{ uri }` or `{ html, baseUrl? }` |
| `userAgent` / `applicationNameForUserAgent` | Replace the user agent, or append to the default one. On iOS the app name is fixed at creation: changing it recreates the WebView |
| `injectedScripts` | `[{ code, when: 'start' \| 'end', mainFrameOnly? }]`. Changes apply from the next navigation |
| `navigationRules`, `onNavigationRequest`, `onNavigation`, `onOpenExternal` | See above |
| `bridge` | `createBridge(...)` |
| `thirdPartyCookies` | Android only. WebKit always blocks third-party cookies (as Safari does) |
| `mediaPlaybackRequiresUserAction` (default true), `allowsInlineMediaPlayback` (iOS, default false) | Fixed at creation on iOS |
| `scrollEnabled`, `bounces` | iOS only, as in react-native-webview |
| `showsScrollIndicators` | |
| `webviewDebuggingEnabled` | Default `__DEV__`. Process-wide on Android |
| `extensions` | See below |
| `renderLoading`, `renderError` | Overlays that cover the WebView while loading, or after a main-frame error until the next load |
| `onNavigationStateChange`, `onLoadStart`, `onLoad`, `onLoadEnd` | `onLoad` doesn't fire for a failed load |
| `onError` | `{ kind: 'network' \| 'http' \| 'ssl', url, code, description, isMainFrame }`. Main-frame errors only. SSL errors are always cancelled |
| `onProcessGone` | `{ didCrash, recovered }`. The core has already reloaded the page; after more than 3 crashes in 60 s it stops reloading |

**Ref methods:** `goBack`, `goForward`, `reload` (retries the failed URL after an error), `stopLoading`, `evaluate(expression)`, `getUrl()`.

`evaluate` waits for a returned Promise on iOS; Android returns only the immediate value, so use the bridge for async results.

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
  ]}
/>
```

| Extension | iOS | Android |
|---|---|---|
| `pullToRefresh()` | `UIRefreshControl` | `SwipeRefreshLayout`. A pull inside a scrolled inner scroller (`overflow: auto`) still reloads |
| `fullscreenVideo({ onChange })` | Built in (WebKit) | The page's fullscreen view covers the activity, system bars hide, and back exits |
| `fileUpload({ onFileRequest? })` | Built in (WebKit's picker; needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`) | `onFileRequest({ accept, multiple, capture })` returns URIs, or `null` to cancel. Without it, the system chooser opens |
| `downloads({ onDownload })` | `WKDownload` into the temporary directory | `DownloadManager` (the page's cookies and user agent, a notification, public Downloads); `data:` and `blob:` go to the cache |
| `permissions({ origins, onPermissionRequest? })` | WebKit asks the OS. `true` skips WebKit's own prompt; other origins are denied | Grants only if the app says yes **and** the OS permission is granted. Never prompts by itself |
| `sharedCookies()` | Copies `HTTPCookieStorage` into the WebView at creation, and back after each load | Built in (`CookieManager` is app-wide, flushed when the app backgrounds) |

### Recipes

File upload with expo-image-picker:

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

Sharing a download with expo-sharing:

```tsx
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
  onEvent: (event, payload) => console.log(event, payload),
});
```

**The hooks:**
- Android: `wrap` (container), `onPageFinished`, `onShowFileChooser`, `onPermissionRequest`, `onGeolocationPrompt`, `onShowCustomView`/`onHideCustomView`, `onDownloadStart`, `onCall` and `onDetach`. The host gives `webView`, `activity`, `emit`, `ask`, `hasPermission` and `launchForResult`.
- iOS: `didCreate`, `didFinish`, `decidePolicy(for:)`, `wantsDownload`, `didBecome(download)`, `requestMediaCapture` and `detach`. The host gives `webView`, `emit` and `ask`.
- **Decide hooks:** the first extension that handles one wins.
- **`ask`:** sends an event to the helper's `onEvent` and passes its return value back to native.

The interface is **experimental** until it has had more outside users.

## Security defaults

- File access is off, mixed content is never allowed, and SSL errors are always cancelled.
- There is no `addJavascriptInterface`.
- The bridge works only for allowed origins, main frame only.
- `intent:` URLs are sanitised.
- Permissions are granted only to configured origins in the main frame, and are denied by default.
- Download filenames are sanitised.
- Debugging is on only in `__DEV__`.

## Development

```sh
npm install && (cd example && npm install)
npm test                                   # TS unit tests (bridge protocol, createBridge, rule matcher)
(cd example/android && ./gradlew :minimal-rn-webview:testDebugUnitTest)   # Kotlin rule matcher
xcrun swiftc ios/NavigationRules.swift ios/Tests/main.swift -o /tmp/rules && /tmp/rules test-vectors/navigation-rules.json
cd example && npm run test-pages           # local test pages on :8090
npx expo run:android | npx expo run:ios
curl 'localhost:8090/harness/run?platform=android&suite=urlTracking'   # scripted on-device suites (example/harness.ts)
```

The design and its decisions are in [`docs/WEBVIEW_PLAN.md`](docs/WEBVIEW_PLAN.md) and [`docs/PHASE0_RESULTS.md`](docs/PHASE0_RESULTS.md).
