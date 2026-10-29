---
title: Migrating from react-native-webview
---

# Migrating from react-native-webview

Most react-native-webview props are platform settings by name here: `thirdPartyCookiesEnabled` is
`android={{ webView: { acceptThirdPartyCookies: true } }}`, `bounces` is `ios={{ scrollView: { bounces: false } }}`,
`cacheMode` is `android.settings.cacheMode`, `allowsBackForwardNavigationGestures` is `ios.webView.<the same name>`; the
keys autocomplete ([platform settings](examples.md#platform-settings)). This page is what differs: the defaults, the
props that became something else, and what has no equivalent. The [requirements](../README.md) are in the README.

## Defaults that differ

| | react-native-webview | Here | To get react-native-webview's |
|---|---|---|---|
| Android third-party cookies | On (`thirdPartyCookiesEnabled`) | The platform's: off. An embedded login or 3-D Secure iframe can lose its session | `android.webView.acceptThirdPartyCookies: true` |
| Android wide viewport | On (`scalesPageToFit`) | The platform's: off. A desktop page without a viewport meta lays out narrower | `android.settings.useWideViewPort` and `loadWithOverviewMode: true` |
| Android overscroll | `always` | The platform's | `android.webView.overScrollMode: 0` |
| Android fullscreen video | Off (`allowsFullscreenVideo`) | On, reported to `onFullscreenChange` | A hook chrome client that takes `onShowCustomView` |
| iOS inline video | Off: video plays in the fullscreen player | On (`allowsInlineMediaPlayback`) | `ios.configuration.allowsInlineMediaPlayback: false` |
| iOS AirPlay | Off | WebKit's: on | `ios.configuration.allowsAirPlayForMediaPlayback: false` |
| iOS data detectors | Phone numbers | None | `ios.configuration.dataDetectorTypes: IOSConstants.DataDetectorTypes.phoneNumber` |
| iOS content insets | `contentInsetAdjustmentBehavior: never`, no automatic indicator insets | UIKit's: `automatic`, and the indicator insets follow | `ios.scrollView.contentInsetAdjustmentBehavior` and `automaticallyAdjustsScrollIndicatorInsets` |
| iOS directional lock | On | UIKit's: off | `ios.scrollView.directionalLockEnabled: true` |
| Debugging | iOS off; Android on in debug builds | iOS on in `__DEV__`; Android on in debug builds | `ios.webView.inspectable`, `WebView.android.setWebContentsDebuggingEnabled` |
| iOS universal links | A tapped one opens the app that claims it | Loads in place, as on Android | An `external` rule for the host |
| Downloads | Android saves to Downloads with `DownloadManager` | Opens externally without `onDownload`; with it, a file in the app's cache | `onDownload` ([page requests](examples.md#page-requests)); on Android a [native hook](examples.md#native-hooks) can take the download first (`onDownloadStart`) and hand it to `DownloadManager` |
| Renderer crash | Reported; the app reloads or remounts | The core reloads, and reports `onProcessGone({ recovered: true })` | Nothing: a `reload()` in `onProcessGone` loads the page twice |
| Messaging | Every page; every frame on Android, the main frame on iOS | Only `allowedOrigins`, main frame only | An iframe's messages need a native hook with a channel of its own |
| Injected script | `injectedJavaScript` runs at document end, on every origin | Every `injectedScripts` entry runs at document start, on its `origins` | Wrap the code in `addEventListener('DOMContentLoaded', …)`; list the origins, or `['*']` |
| Failed load | An "Error loading page" view replaces the page, with or without `renderError` | No error view of its own on iOS, which keeps the page before it; Android shows WebView's own error page ([`onError`](https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onerror)) | The error screen [below](#loading-and-error-screens) |
| Android file chooser | Offers the camera, and opens it for `capture`, asking for the OS permissions itself | The system chooser, which ignores `capture` | `onFileRequest` with expo-image-picker ([page requests](examples.md#page-requests)) |

The settings in one object, for the rows a setting restores:

```tsx
import { IOSConstants, type WebViewProps } from 'react-native-minimal-webview';

export const rnwDefaults = {
  ios: {
    configuration: {
      allowsInlineMediaPlayback: false,
      allowsAirPlayForMediaPlayback: false,
      dataDetectorTypes: IOSConstants.DataDetectorTypes.phoneNumber,
    },
    scrollView: {
      contentInsetAdjustmentBehavior: IOSConstants.ContentInsetAdjustmentBehavior.never,
      automaticallyAdjustsScrollIndicatorInsets: false,
      directionalLockEnabled: true,
    },
  },
  android: {
    settings: { useWideViewPort: true, loadWithOverviewMode: true },
    webView: { acceptThirdPartyCookies: true, overScrollMode: 0 }, // 0: View.OVER_SCROLL_ALWAYS
  },
} satisfies Pick<WebViewProps, 'ios' | 'android'>;

<WebView ios={rnwDefaults.ios} android={rnwDefaults.android} … />
```

To add your own keys, merge each root: `ios={{ ...rnwDefaults.ios, scrollView: { ...rnwDefaults.ios.scrollView, bounces: false } }}`.

## Props that became something else

| react-native-webview | Here |
|---|---|
| `onShouldStartLoadWithRequest`, `originWhitelist`, `onOpenWindow` | `navigationRules`; an `ask` rule calls `onNavigationRequest` ([below](#onshouldstartloadwithrequest)) |
| `injectedJavaScript`, `injectedJavaScriptBeforeContentLoaded`, `injectedJavaScriptObject`, `…ForMainFrameOnly` | `injectedScripts: [{ code, allFrames, origins }]`, all at document start; `…ForMainFrameOnly: false` is `allFrames: true` |
| `injectJavaScript(code)` | `evaluate(expression)` ([below](#injectjavascript)) |
| `onMessage`, `postMessage`, `window.ReactNativeWebView` | The bridge, and `reactNativeWebViewMessages` for pages that use `window.ReactNativeWebView` ([below](#postmessage-and-onmessage)) |
| `onLoad`, `onLoadProgress` | `onLoadEnd` with `state.outcome === 'finished'`; `progress` in `useWebViewState` |
| `onError`, `onHttpError` | `onError`, with `kind` `'network'`, `'ssl'` or `'http'` |
| `onContentProcessDidTerminate`, `onRenderProcessGone` | `onProcessGone` |
| `renderLoading`, `renderError`, `startInLoadingState` | Your own views over the WebView ([below](#loading-and-error-screens)) |
| `onScroll`, `onContentSizeChange` | An injected script that reports over the bridge ([below](#scroll-position)) |
| `source={require('./page.html')}` | A `file://` uri from expo-asset (`localUri`) |
| `allowingReadAccessToURL` | `source.readAccessRoot` |
| `source.method`, `source.body` | `source.body` makes the request a POST |
| `onFileDownload` | `onDownload`, on both platforms: the core saves the file |
| `sharedCookiesEnabled`, `pullToRefreshEnabled` | `sharedCookies`, `pullToRefresh` |
| File input, `mediaCapturePermissionGrantType`, `geolocationEnabled`, `allowsProtectedMedia` | `onFileRequest` (Android; iOS shows WebKit's picker), `onPermissionRequest` ([page requests](examples.md#page-requests)) |
| `clearCache`, `clearHistory`, `clearFormData`, `requestFocus` | On Android `call('webView.clearCache', [true])` and the like; on iOS `call('websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:', …)` clears the cache, and the back-forward list can't be cleared |
| `basicAuthCredential`, custom JS dialogs, `menuItems`, `onCustomMenuSelection`, `suppressMenuItems`, `keyboardDisplayRequiresUserAction`, `hideKeyboardAccessoryView`, `removeIosKeyboardObserver`, `refreshControlLightMode`, `downloadingMessage`, `nativeConfig` | A [native hook](examples.md#native-hooks) |
| `incognito` | `ios.configuration.websiteDataStore: 'nonPersistent'`; on Android the clearing calls react-native-webview makes ([below](#incognito)) |
| `scrollEnabled` (Android), `autoManageStatusBarEnabled`, `useSharedProcessPool`, `ignoreSilentHardwareSwitch`, `enableApplePay` | Not supported: inject CSS `overflow: hidden`; iOS uses WebKit's own fullscreen; `WKProcessPool` has had no effect since iOS 15; react-native-webview keeps a silent `<audio>` playing for it; Apple Pay works with scripts injected since iOS 16 |

The props whose setting has another name:

| react-native-webview | Here |
|---|---|
| `showsVerticalScrollIndicator`, `showsHorizontalScrollIndicator` | `ios.scrollView.<the same name>`; `android.webView.verticalScrollBarEnabled`, `horizontalScrollBarEnabled` |
| `mediaPlaybackRequiresUserAction` | `ios.configuration.mediaTypesRequiringUserActionForPlayback`, `android.settings.mediaPlaybackRequiresUserGesture` (its default is both platforms' default) |
| `contentMode` | `ios.webpagePreferences.preferredContentMode` (`IOSConstants.ContentMode`) |
| `cacheEnabled: false` | `ios.configuration.websiteDataStore: 'nonPersistent'`, `android.settings.cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE` |
| `automaticallyAdjustContentInsets` | `ios.scrollView.contentInsetAdjustmentBehavior` |
| `forceDarkOn` | `android.settings.algorithmicDarkeningAllowed` (`forceDark` below `targetSdk` 33) |
| `saveFormDataDisabled` | `android.settings.saveFormData: false` (a no-op since API 26, there too) |
| `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs` | `android.settings.<the same name>`; on iOS `ios.preferences.allowFileAccessFromFileURLs` and `ios.configuration.allowUniversalAccessFromFileURLs` |
| `nestedScrollEnabled` | `android.webView.nestedScrollingEnabled` |
| `androidLayerType` | `call('webView.setLayerType', [type, null])`, `type` 0, 1 or 2 (`View.LAYER_TYPE_*`); again after a renderer crash |
| `style={{ backgroundColor: 'transparent' }}` | `android.webView.other.backgroundColor: 0`; on iOS `call('webView.setOpaque:', [false])` once mounted, again when it remounts (`ios.webView.opaque` is refused) |
| `containerStyle` | A `View` around the WebView |

## What else changes

- The `LSApplicationQueriesSchemes` (iOS) and `<queries>` (Android) entries you added for the schemes a page opens can
  go ([`onOpenExternal`](https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onopenexternal)).
- After a server redirect the rules block, the state is the page before it with `outcome` `cancelled`.
  react-native-webview reports the redirecting URL as still loading (iOS) or the blocked URL as loaded (Android).
- A rule decides natively, so a busy JS thread doesn't hold it up. react-native-webview's Android blocks the UI thread
  waiting for `onShouldStartLoadWithRequest`, then lets the navigation through on a timeout; its iOS waits for the
  answer.

## onShouldStartLoadWithRequest

Navigation rules replace the callback.

```tsx
// was: onShouldStartLoadWithRequest returning true for https://example.com/ and opening the rest with Linking
<WebView
  navigationRules={[
    { host: ['example.com'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' }, // iframes
    { mainFrame: true, action: 'ask' }, // the rest: onNavigationRequest answers within 1 s, later counts as block
  ]}
  onNavigationRequest={({ url, newWindow, userInitiated }) => (isTrusted(url) ? 'allow' : 'external')}
/>
```

The request has `url`, `mainFrame` (was `isTopFrame`), `newWindow` and `userInitiated` (in place of `navigationType`
`click`); there is no `navigationType` or `mainDocumentURL`. A new window (`onOpenWindow`) is a navigation with
`newWindow: true`. react-native-webview on iOS also passes form POSTs to the callback.

## injectJavaScript

```ts
// was ref.current.injectJavaScript(`document.body.style.background = 'red'; true;`)
await ref.current?.evaluate(`(() => { document.body.style.background = 'red'; })()`);
const title = await ref.current?.evaluate('document.title');
```

## postMessage and onMessage

The [bridge](examples.md#the-bridge) replaces both with calls that return promises and events, in both directions, for
the origins you allow. Pages that call `window.ReactNativeWebView.postMessage(string)` and listen for `message` events
keep working with [`reactNativeWebViewMessages`](https://rasmuskard.github.io/react-native-minimal-webview/variables/reactNativeWebViewMessages.html) in `injectedScripts`.

```tsx
import { reactNativeWebViewMessages } from 'react-native-minimal-webview';

<WebView bridge={bridge} injectedScripts={[reactNativeWebViewMessages]} … />

useEffect(() => bridge.on('rnw', (data) => handleMessage(data as string)), [bridge]); // was onMessage
bridge.emit('rnw', message); // was ref.current.postMessage(message)
```

## incognito

On iOS a non-persistent data store holds the WebView's cookies, cache and storage and goes with it. Android has no
incognito WebView: react-native-webview's `incognito` clears the app-wide cookies and the cache, which this does before
the page loads (the calls need a mounted WebView, so the first `source` is blank).

```tsx
const [source, setSource] = useState<WebViewSource>({ uri: 'about:blank' });
useEffect(() => {
  (async () => {
    if (Platform.OS === 'android') {
      await ref.current?.call('cookieManager.removeAllCookies'); // app-wide, as on react-native-webview
      await ref.current?.call('webView.clearCache', [true]);
    }
    setSource({ uri: 'https://example.com' });
  })();
}, []);
<WebView
  ref={ref}
  source={source}
  ios={{ configuration: { websiteDataStore: 'nonPersistent' } }}
  android={{ settings: { cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE } }}
/>;
```

## Loading and error screens

The navigation state and `onError` give the same screens, under your own layout. An HTTP error status (404, 503) is
not a failed load: the site's own page shows, so the recipe skips `kind: 'http'`.

```tsx
const { loading } = useWebViewState(ref);
const [error, setError] = useState<LoadErrorEvent | null>(null);
<View style={{ flex: 1 }}>
  <WebView
    ref={ref}
    source={source}
    onError={(e) => e.kind !== 'http' && setError(e)}
    onLoadStart={() => setError(null)}
    style={{ flex: 1 }}
  />
  {error ? (
    <OfflineScreen style={StyleSheet.absoluteFill} error={error} onRetry={() => ref.current?.reload()} />
  ) : loading ? (
    <ActivityIndicator style={StyleSheet.absoluteFill} />
  ) : null}
</View>
```

## Scroll position

An injected script reports the main frame's scroll position over the bridge, at most once per frame, for the pages
in `allowedOrigins`. For offsets during a bounce or a pinch, a native hook observes `scrollView.contentOffset` on iOS
and adds a listener to `context.scrollListeners` on Android.

```tsx
const scroll = {
  code: `let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; window.nativeBridge?.emit('scroll', { x: scrollX, y: scrollY }); });
  }, { passive: true });`,
  origins: ['*'], // the bridge scopes it
} as const;

<WebView bridge={bridge} injectedScripts={[scroll]} … />
useEffect(() => bridge.on('scroll', (position) => onScroll(position as { x: number; y: number })), [bridge]);
```
