# Migrating from react-native-webview

This package has 23 props of its own, plus `ref` and React Native's `ViewProps`. Most of what react-native-webview
has a prop for is a platform setting by name here (`ios`, `android`, `get`, `call`; see
[Platform settings](platform-settings.md)), a recipe, or a [native hook](native-hooks.md). It runs on iOS 16.4+ and Android API 29+, with the new architecture only
([requirements](../README.md)).

## Defaults that differ

| | react-native-webview | Here | To get react-native-webview's |
|---|---|---|---|
| Android third-party cookies | On (`thirdPartyCookiesEnabled`) | The platform's: off. An embedded login or 3-D Secure iframe can lose its session | `android.webView.acceptThirdPartyCookies: true` |
| Android wide viewport | On (`scalesPageToFit`) | The platform's: off. A desktop page without a viewport meta lays out narrower | `android.settings.useWideViewPort` and `loadWithOverviewMode: true` |
| Android overscroll | `always` | The platform's | `android.webView.overScrollMode: 0` |
| Android fullscreen video | Off (`allowsFullscreenVideo`) | On, reported to `onFullscreenChange` | A hook chrome client that takes `onShowCustomView` |
| iOS inline video | Off: video plays in the fullscreen player | On (`allowsInlineMediaPlayback`) | `ios.configuration.allowsInlineMediaPlayback: false` |
| iOS AirPlay | Off | WebKit's: on | `ios.configuration.allowsAirPlayForMediaPlayback: false` |
| iOS data detectors | Phone numbers | None | `ios.configuration.dataDetectorTypes: WK.DataDetectorTypes.phoneNumber` |
| iOS content insets | `contentInsetAdjustmentBehavior: never`, no automatic indicator insets | UIKit's: `automatic`, and the indicator insets follow | `ios.scrollView.contentInsetAdjustmentBehavior` and `automaticallyAdjustsScrollIndicatorInsets` |
| iOS directional lock | On | UIKit's: off | `ios.scrollView.directionalLockEnabled: true` |
| Debugging | iOS off; Android on in debug builds | On in `__DEV__`, on both | `ios.webView.inspectable`, `android.webView.webContentsDebuggingEnabled` |
| iOS universal links | A tapped one opens the app that claims it | Loads in place ([Universal links stay in place](decisions.md#universal-links-stay-in-place)) | An `external` rule for the host |
| Downloads | Android saves to Downloads with `DownloadManager` | Opens externally without `onDownload`; with it, a file in the app's cache | [`onDownload`](page-requests.md#downloads) and a recipe |
| Renderer crash | Reported; the app reloads or remounts | The core reloads, and reports `onProcessGone({ recovered: true })` | Nothing: a `reload()` in `onProcessGone` loads the page twice |
| Messaging | Every page and every frame | Only `allowedOrigins`, main frame only | [Messages from iframes](#messages-from-iframes) |
| Injected script | `injectedJavaScript` runs at document end | Every `injectedScripts` entry runs at document start | Wrap the code in `addEventListener('DOMContentLoaded', …)` |

The settings in one object, for the rows a setting restores:

```tsx
import { WK, type WebViewProps } from 'minimal-rn-webview';

export const rnwDefaults = {
  ios: {
    configuration: {
      allowsInlineMediaPlayback: false,
      allowsAirPlayForMediaPlayback: false,
      dataDetectorTypes: WK.DataDetectorTypes.phoneNumber,
    },
    scrollView: {
      contentInsetAdjustmentBehavior: WK.ContentInsetAdjustmentBehavior.never,
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

## Prop map

**Loading and content**

| react-native-webview | Here |
|---|---|
| `source` `{ uri, headers, method, body }`, `{ html, baseUrl }` | `source` `{ uri, headers?, body? }` (a `body` makes it a POST), `{ html, baseUrl? }` |
| `source={require('./page.html')}` | Not accepted. Get a `file://` uri from expo-asset (`localUri`); Android also needs `android.settings.allowFileAccess: true` |
| `allowingReadAccessToURL` | A `file://` source gets read access to its own directory; a parent directory isn't possible |
| `onLoadStart`, `onLoadEnd` | The same names, with the [navigation state](navigation-state.md); `onLoadEnd`'s `state.outcome` says how the load ended |
| `onLoad` | `onLoadEnd` with `state.outcome === 'finished'` |
| `onLoadProgress` | `progress` in `useWebViewState` or `onNavigationStateChange` |
| `onNavigationStateChange` | The same name; the state has `url`, `pendingUrl`, `title`, `loading`, `progress`, `canGoBack`, `canGoForward` and `outcome` |
| `onError` | `onError` with `kind: 'network'` or `'ssl'` |
| `onHttpError` | `onError` with `kind: 'http'` (`url`, `statusCode`) |
| `onLoadSubResourceError` | A hook client's `onReceivedError`, which sees every frame's errors (Android) |
| `renderLoading`, `renderError`, `startInLoadingState` | [Loading and error screens](#loading-and-error-screens) |
| `onContentProcessDidTerminate`, `onRenderProcessGone` | `onProcessGone({ didCrash, recovered })`; the core reloads by itself |
| `cacheEnabled` | iOS `ios.configuration.websiteDataStore: 'nonPersistent'`, Android `android.settings.cacheMode: Android.WebSettings.LOAD_NO_CACHE` |
| `cacheMode` | `android.settings.cacheMode` |
| `incognito` | iOS `ios.configuration.websiteDataStore: 'nonPersistent'`. Android: not supported ([roadmap](../ROADMAP.md)) |
| `userAgent` | `userAgent` |
| `applicationNameForUserAgent` | iOS `ios.configuration.applicationNameForUserAgent`; Android `android.settings.userAgentString` from `WebView.defaultUserAgent` plus the suffix |
| `javaScriptEnabled` | `android.settings.javaScriptEnabled`, `ios.webpagePreferences.allowsContentJavaScript` (the bridge needs JS) |

**Navigation**

| react-native-webview | Here |
|---|---|
| `onShouldStartLoadWithRequest` | [Navigation rules](#onshouldstartloadwithrequest) |
| `originWhitelist` | Navigation rules. With none, http(s) loads in place and other schemes open externally, as with react-native-webview's default |
| `onOpenWindow` | A `{ newWindow: true }` rule; see [below](#onshouldstartloadwithrequest) |
| `setSupportMultipleWindows` | On by default, so new windows reach the rules (`android.settings.supportMultipleWindows`) |
| `javaScriptCanOpenWindowsAutomatically` | `ios.preferences.` and `android.settings.javaScriptCanOpenWindowsAutomatically` |
| `limitsNavigationsToAppBoundDomains` | `ios.configuration.limitsNavigationsToAppBoundDomains` |
| `allowsBackForwardNavigationGestures`, `allowsLinkPreview` | `ios.webView.<the same name>` |
| `fraudulentWebsiteWarningEnabled`, `textInteractionEnabled` | `ios.preferences.<the same name>` |

**Scripts and messaging**

| react-native-webview | Here |
|---|---|
| `injectedJavaScript`, `injectedJavaScriptBeforeContentLoaded` | `injectedScripts: [{ code }]`, at document start |
| `injectedJavaScript…ForMainFrameOnly` | `mainFrameOnly` (default `true`) |
| `injectedJavaScriptObject` | `` injectedScripts: [{ code: `window.config = ${JSON.stringify(config)}` }] `` |
| `injectJavaScript(code)` | [`evaluate`](#injectjavascript) |
| `onMessage`, `postMessage` | [The bridge](#postmessage-and-onmessage) |
| `webviewDebuggingEnabled` | `ios.webView.inspectable`, `android.webView.webContentsDebuggingEnabled` (default `__DEV__`) |

**Media, permissions, files and downloads**

| react-native-webview | Here |
|---|---|
| `mediaPlaybackRequiresUserAction` | `ios.configuration.mediaTypesRequiringUserActionForPlayback` (`WK.AudiovisualMediaTypes`), `android.settings.mediaPlaybackRequiresUserGesture`; both default to requiring it |
| `allowsInlineMediaPlayback`, `allowsPictureInPictureMediaPlayback`, `allowsAirPlayForMediaPlayback` | `ios.configuration.<the same name>` |
| `allowsFullscreenVideo` | On by default; `onFullscreenChange` (Android) |
| `autoManageStatusBarEnabled` | Not supported: iOS uses WebKit's own fullscreen |
| `mediaCapturePermissionGrantType`, `geolocationEnabled`, `allowsProtectedMedia` | `onPermissionRequest` ([page requests](page-requests.md)) |
| File input | `onFileRequest` (Android); iOS shows WebKit's picker |
| `onFileDownload` | `onDownload`, on both platforms: the core saves the file |
| `downloadingMessage`, `lackPermissionToDownloadMessage` | Not supported: the app shows its own UI in `onDownload` |
| `basicAuthCredential` | A native hook (`HookAuth` in `example/modules/sample-extension`) |
| `enableApplePay` | No prop. On iOS this package adds user scripts only for `bridge` and `injectedScripts` |

**Storage, cookies and file access**

| react-native-webview | Here |
|---|---|
| `sharedCookiesEnabled` | `sharedCookies` |
| `thirdPartyCookiesEnabled` | `android.webView.acceptThirdPartyCookies` (default off, see [above](#defaults-that-differ)) |
| `domStorageEnabled` | On by default (`android.settings.domStorageEnabled`) |
| `saveFormDataDisabled` | `android.settings.saveFormData: false` |
| `allowFileAccess`, `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs` | `android.settings.<the same name>`. On iOS the last two aren't public WebKit properties: a native hook |
| `mixedContentMode` | `android.settings.mixedContentMode` (`Android.WebSettings.MIXED_CONTENT_…`) |

**Scrolling, layout and rendering**

| react-native-webview | Here |
|---|---|
| `style` | Styles the container view. A transparent page also needs the WebView's own background cleared: `ios.webView.opaque: false` with `backgroundColor: '#00000000'`, and `android.webView.backgroundColor: 0` (keys outside the generated list, not covered by the on-device suites) |
| `containerStyle` | Wrap the `WebView` in a `View` |
| `bounces`, `scrollEnabled`, `pagingEnabled`, `directionalLockEnabled`, `decelerationRate`, `indicatorStyle`, `showsHorizontalScrollIndicator`, `showsVerticalScrollIndicator`, `contentInset`, `contentInsetAdjustmentBehavior`, `automaticallyAdjustsScrollIndicatorInsets` | `ios.scrollView.<the same name>`, enums as numbers (`WK.IndicatorStyle`, `WK.ContentInsetAdjustmentBehavior`; `decelerationRate: 0.998`) |
| `automaticallyAdjustContentInsets` | `ios.scrollView.contentInsetAdjustmentBehavior` |
| `scrollEnabled` (Android) | Not supported: injected CSS `overflow: hidden` ([roadmap](../ROADMAP.md)) |
| `showsHorizontalScrollIndicator`, `showsVerticalScrollIndicator` (Android) | `android.webView.horizontalScrollBarEnabled`, `verticalScrollBarEnabled` |
| `overScrollMode` | `android.webView.overScrollMode`, a number (`0` always, `1` if content scrolls, `2` never) |
| `nestedScrollEnabled` | A native hook |
| `onScroll` | [Scroll position](#scroll-position) |
| `onContentSizeChange` | A `ResizeObserver` in `injectedScripts` that reports over the bridge, like [Scroll position](#scroll-position) |
| `contentMode` | `ios.webpagePreferences.preferredContentMode` (`WK.ContentMode`) |
| `dataDetectorTypes` | `ios.configuration.dataDetectorTypes` (`WK.DataDetectorTypes`, combined with `\|`) |
| `scalesPageToFit` | `android.settings.useWideViewPort` and `loadWithOverviewMode` |
| `setBuiltInZoomControls`, `setDisplayZoomControls` | `android.settings.builtInZoomControls`, `displayZoomControls`; the defaults are the same |
| `textZoom`, `minimumFontSize` | `android.settings.<the same name>`; iOS `ios.preferences.minimumFontSize` |
| `forceDarkOn` | `android.settings.algorithmicDarkeningAllowed` |
| `paymentRequestEnabled` | `android.settings.paymentRequestEnabled` |
| `androidLayerType` | `call('webView.setLayerType', [1, null])`, again after a renderer crash (a new WebView) |
| `pullToRefreshEnabled` | `pullToRefresh` |
| `refreshControlLightMode`, `keyboardDisplayRequiresUserAction`, `hideKeyboardAccessoryView`, `removeIosKeyboardObserver`, `menuItems`, `onCustomMenuSelection`, `suppressMenuItems` | A native hook |
| `nativeConfig` | A native hook, or `MinimalWebViewHooks.webViewClass` (iOS) and `webViewFactory` (Android) for a subclass |
| `useSharedProcessPool` | Not supported: `WKProcessPool` has no effect since iOS 15 |

**Ref methods**

| react-native-webview | Here |
|---|---|
| `goBack`, `goForward`, `reload`, `stopLoading` | The same |
| `injectJavaScript` | [`evaluate`](#injectjavascript) |
| `postMessage` | [`bridge.emit`](#postmessage-and-onmessage) |
| `requestFocus` | Android `call('webView.requestFocus')`; iOS: none |
| `clearCache`, `clearFormData`, `clearHistory` | `call('webView.clearCache', [true])`, `call('webView.clearFormData')`, `call('webView.clearHistory')` on Android; on iOS `websiteDataStore.removeDataOfTypes:…` ([`call`](platform-settings.md#call)) clears the cache, and the back-forward list can't be cleared |

## injectJavaScript

`evaluate` runs an expression, not statements, and resolves with its value. react-native-webview's
`'stmt; stmt; true;'` is a syntax error here: put statements in a function.

```ts
// was ref.current.injectJavaScript(`document.body.style.background = 'red'; true;`)
await ref.current?.evaluate(`(() => { document.body.style.background = 'red'; })()`);
const title = await ref.current?.evaluate('document.title');
```

It returns a promise that rejects with `script_error` when the script throws or doesn't parse, so await or catch it
([ref methods](props.md#ref-methods)).

## onShouldStartLoadWithRequest

Navigation rules replace the callback: they run natively, in order, with no JS round trip
([Navigation rules](navigation-rules.md)). The usual allow-list:

```tsx
// was: onShouldStartLoadWithRequest returning true for https://example.com/ and opening the rest with Linking
<WebView
  navigationRules={[
    { host: ['example.com'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' }, // iframes
    { mainFrame: true, action: 'external' }, // the rest opens in the browser or the app for it
  ]}
/>
```

For logic a rule can't express, an `ask` rule calls `onNavigationRequest`, which answers `allow`, `block` or
`external` within 1 s (later counts as `block`). On Android `ask` works for the main frame only, cancels the
navigation and reissues it on `allow`, and POST requests skip the rules
([platform differences](navigation-rules.md#platform-differences)).

```tsx
navigationRules={[{ host: ['example.com'], action: 'allow' }, { mainFrame: true, action: 'ask' }]}
onNavigationRequest={({ url, newWindow, userInitiated }) => (isTrusted(url) ? 'allow' : 'external')}
```

The request has `url`, `mainFrame` (was `isTopFrame`), `newWindow` and `userInitiated` (in place of `navigationType`
`click`); there is no `navigationType` or `mainDocumentURL`. The `source` load, reloads and back/forward skip the
rules (their redirects don't). To only watch navigations, `onNavigation` reports every decision and the rule that made it.

`onOpenWindow`: a new window (`target=_blank`, `window.open`) is a navigation with `newWindow: true`. By default an
allowed one loads in place ([New windows load in place](decisions.md#new-windows-load-in-place)); `{ newWindow: true, action: 'external' }`
opens it in the browser, and `{ newWindow: true, action: 'ask' }` gives it to `onNavigationRequest`.

## postMessage and onMessage

The [bridge](bridge.md) replaces both with calls that return promises (`call` and `handle`) and events (`emit` and
`on`), in both directions, for the origins you allow.

Pages that call `window.ReactNativeWebView.postMessage(string)` and listen for `message` events keep working through
the bridge. Only `allowedOrigins` get `ReactNativeWebView`, and only in the main frame; react-native-webview gives it
to every page and every iframe.

```tsx
const rnwMessages = {
  // Runs after the bridge's own script, so `window.nativeBridge` already exists.
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

## Messages from iframes

The bridge serves only the main frame. A page that embeds a widget whose iframe posts to the app needs an extension:
a [native hook](native-hooks.md) that adds its own channel under its own name, next to the bridge's. On iOS, a
`WKScriptMessageHandler` added to `configuration.userContentController` in `configure` (it hears every frame, and
`message.frameInfo` names the one that sent it), with a user script for the frames (`forMainFrameOnly: false`). On
Android, `WebViewCompat.addWebMessageListener` in `attach`, with the frames' origins as its rules (its listener gets
`sourceOrigin` and `isMainFrame`). The hook passes the messages on with `context.emit` (`onHookEvent`) and takes
replies with `context.handle` (`ref.hook`). On iOS any frame of any origin can post to the handler, so check
`message.frameInfo.securityOrigin`.

## Loading and error screens

There is no `renderLoading` or `renderError`: the navigation state and `onError` give the same screens, under your own
layout.

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

An HTTP error status (404, 503) is not a failed load: the site's own page shows, so the recipe skips `kind: 'http'`.

## Scroll position

There is no `onScroll` prop. An injected script reports the main frame's scroll position over the bridge, at most once
per frame:

```tsx
const scroll = {
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

Only pages in `allowedOrigins` report. For offsets during a bounce or a pinch, a [native hook](native-hooks.md) can
observe `scrollView.contentOffset` on iOS and `setOnScrollChangeListener` on Android.
