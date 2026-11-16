---
title: Migrating from react-native-webview
---

# Migrating from react-native-webview

Each react-native-webview prop's counterpart here, and the defaults and behavior that differ. The
[requirements](../README.md#requirements) are in the README.

Most props are platform settings by the same name: `bounces` is `ios={{ scrollView: { bounces: false } }}`, and
`textZoom` is `android={{ settings: { textZoom: 120 } }}`. An enum string becomes a constant: `cacheMode: 'LOAD_NO_CACHE'`
is `AndroidConstants.WebSettings.LOAD_NO_CACHE`. For a prop no table here lists, [use a platform API](platform-apis.md)
finds its key.

## Defaults that differ

|                                           | react-native-webview             | Here                             | To get the old behavior                                  |
| ----------------------------------------- | -------------------------------- | -------------------------------- | -------------------------------------------------------- |
| Android overscroll                        | Always                           | The platform's                   | `android.webView.overScrollMode: 0`                      |
| iOS inline video                          | Off                              | On                               | `ios.configuration.allowsInlineMediaPlayback: false`     |
| iOS AirPlay                               | Off                              | On                               | `ios.configuration.allowsAirPlayForMediaPlayback: false` |
| iOS content insets                        | `never`, indicators not adjusted | `automatic`, indicators adjusted | Two `ios.scrollView` keys, below                         |
| iOS debugging (`webviewDebuggingEnabled`) | Off                              | On in `__DEV__`                  | `ios.webView.inspectable: false`                         |
| Android back-forward cache                | Off                              | On, with WebView 146 and newer   | `android.settings.backForwardCacheEnabled: false`        |

The same settings in one object, debugging and the back-forward cache left on:

```tsx
import { IOSConstants, WebView, type WebViewProps } from 'react-native-minimal-webview';

export const rnwDefaults = {
  ios: {
    configuration: { allowsInlineMediaPlayback: false, allowsAirPlayForMediaPlayback: false },
    scrollView: {
      contentInsetAdjustmentBehavior: IOSConstants.ContentInsetAdjustmentBehavior.never,
      automaticallyAdjustsScrollIndicatorInsets: false,
    },
  },
  android: {
    webView: { overScrollMode: 0 }, // 0: View.OVER_SCROLL_ALWAYS
  },
} satisfies Pick<WebViewProps, 'ios' | 'android'>;

export function Browser() {
  return (
    <WebView
      source={{ uri: 'https://example.com' }}
      ios={rnwDefaults.ios}
      android={rnwDefaults.android}
      style={{ flex: 1 }}
    />
  );
}
```

To add your own keys, merge each root: `ios={{ ...rnwDefaults.ios, scrollView: { ...rnwDefaults.ios.scrollView, bounces: false } }}`.

## Behavior that differs

|                                                                       | react-native-webview                                                                   | Here                                                                                                                 | To get the old behavior                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Android fullscreen video (`allowsFullscreenVideo`)                    | Off                                                                                    | On ([`onFullscreenChange`][onfullscreenchange])                                                                      | A native hook that takes `onShowCustomView`                                       |
| iOS universal links                                                   | Open the app that claims them                                                          | Load in place                                                                                                        | An `external` rule for the host                                                   |
| Downloads                                                             | Android: saved to Downloads                                                            | Open externally, or [`onDownload`][ondownload] saves them                                                            | [`downloadManager`][downloadmanager] (Android)                                    |
| Renderer crash                                                        | Reported                                                                               | The core reloads ([`onProcessGone`][onprocessgone])                                                                  | Remove your `reload()`, and offer a retry while [`recovered`][recovered] is false |
| Messaging                                                             | Every page; on Android every frame                                                     | `allowedOrigins`, main frame                                                                                         | An iframe's: a native hook                                                        |
| Injected script                                                       | Document end, every origin                                                             | Document start, its `origins`                                                                                        | `addEventListener('DOMContentLoaded', …)`; `origins: ['*']`                       |
| Failed load                                                           | An error view over the page                                                            | iOS keeps the old page, Android shows its own                                                                        | The [error screen](examples.md#loading-and-error-screens)                         |
| Android file input                                                    | Offers the camera when the app has its permission                                      | The system chooser, which ignores `capture`                                                                          | [`onFileRequest`][onfilerequest]                                                  |
| Android camera and microphone, and location with `geolocationEnabled` | Granted to every page, after asking the OS                                             | Denied                                                                                                               | [`onPermissionRequest`][onpermissionrequest]                                      |
| A link to another scheme (`tel:`, `myapp:`)                           | Opens externally                                                                       | Opens externally only from the main frame, after a user gesture ([`defaultNavigationRules`][defaultnavigationrules]) | An `external` rule for the scheme                                                 |
| New window (`target=_blank`, `window.open`)                           | iOS: loads in place. Android: nothing shows, unless `setSupportMultipleWindows` is off | The rules decide it, and an allowed one loads in place ([`newWindow`][newwindow])                                    | A rule with `newWindow: true`                                                     |
| Android System WebView older than 101                                 | Messaging and injected scripts work                                                    | Neither does ([versions](android-system-webview.md))                                                                 |                                                                                   |

## Props that became something else

| react-native-webview                                                                           | Here                                                                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `onShouldStartLoadWithRequest`, `originWhitelist`, `onOpenWindow`, `setSupportMultipleWindows` | `navigationRules` ([below](#onshouldstartloadwithrequest))                      |
| `injectedJavaScript`, `injectedJavaScriptBeforeContentLoaded`, `injectedJavaScriptObject`      | `injectedScripts`                                                               |
| `…ForMainFrameOnly: false`                                                                     | `allFrames: true` on the script                                                 |
| `injectJavaScript(code)`                                                                       | `evaluate(expression)` ([below](#injectjavascript))                             |
| `onMessage`, `postMessage`, `window.ReactNativeWebView`                                        | The bridge ([below](#postmessage-and-onmessage))                                |
| `onLoad`                                                                                       | `onLoadEnd`, with `state.outcome === 'finished'`                                |
| `onLoadProgress`                                                                               | `progress` in `useWebViewState`                                                 |
| `onError`, `onHttpError`                                                                       | `onError`, whose `kind` is `'network'`, `'ssl'` or `'http'`                     |
| `onContentProcessDidTerminate`, `onRenderProcessGone`                                          | `onProcessGone`, whose `cause` is `'crash'`, `'memory'` or, on iOS, `'unknown'` |
| `renderLoading`, `renderError`, `startInLoadingState`                                          | [Your own views](examples.md#loading-and-error-screens), shown on every load    |
| `onContentSizeChange`                                                                          | An injected script, as for the [scroll position](#scroll-position)              |
| `source={require('./page.html')}`                                                              | A `file://` URI from expo-asset ([local files](examples.md#local-files))        |
| `allowingReadAccessToURL`                                                                      | `source.readAccessRoot`                                                         |
| `source.method`, `source.body`                                                                 | `source.body`, which makes the request a POST                                   |
| `onFileDownload`                                                                               | `onDownload`, on both platforms: it gets the saved file, not a URL to fetch     |
| `sharedCookiesEnabled`, `pullToRefreshEnabled`                                                 | `sharedCookies`, `pullToRefresh`                                                |
| `mediaCapturePermissionGrantType`, `geolocationEnabled`, `allowsProtectedMedia`                | `onPermissionRequest`                                                           |
| `clearCache(true)`, `clearHistory`, `clearFormData`, `requestFocus`                            | `call('webView.clearCache', [true])` and so on, on Android                      |
| `nativeConfig`                                                                                 | A [native hook](native-hooks.md)                                                |
| `containerStyle`                                                                               | A `View` around the WebView                                                     |

On iOS, WebKit's data store clears with `call` ([reading and calling](examples.md#reading-and-calling)).

### Props that became extensions

These props are functions of
[@react-native-minimal-webview/extensions](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/), which
has the setup. You pass each one in the `extensions` prop, and their callbacks get the event without
react-native-webview's `nativeEvent` around it:

| react-native-webview                                      | Here                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `basicAuthCredential`                                     | [`basicAuthCredential`][basicauthcredential]                             |
| `incognito`                                               | [`incognito`][incognito]                                                 |
| `menuItems`, `suppressMenuItems`, `onCustomMenuSelection` | [`menuItems`][menuitems]                                                 |
| `onScroll`                                                | [`onScroll`][onscroll]                                                   |
| `style={{ backgroundColor: 'transparent' }}`              | [`transparentBackground`][transparentbackground]                         |
| `hideKeyboardAccessoryView`                               | [`hideKeyboardAccessoryView`][hidekeyboardaccessoryview]                 |
| `keyboardDisplayRequiresUserAction`                       | [`keyboardDisplayRequiresUserAction`][keyboarddisplayrequiresuseraction] |
| `refreshControlLightMode`                                 | [`refreshControlLightMode`][refreshcontrollightmode]                     |
| `removeIosKeyboardObserver`                               | [`removeIosKeyboardObserver`][removeioskeyboardobserver]                 |
| `nestedScrollEnabled`                                     | [`nestedScrollEnabled`][nestedscrollenabled]                             |
| `androidLayerType`                                        | [`androidLayerType`][androidlayertype]                                   |
| Android downloads, `downloadingMessage`                   | [`downloadManager`][downloadmanager]                                     |
| `onLoadSubResourceError`                                  | [`onLoadSubResourceError`][onloadsubresourceerror]                       |
| JS dialogs (no prop)                                      | [`dialogs`][dialogs]                                                     |

### Settings with another name

| react-native-webview               | `ios`                                                    | `android`                                                                |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `scrollEnabled`                    | `scrollView.scrollEnabled`                               |                                                                          |
| `showsVerticalScrollIndicator`     | `scrollView.<the same name>`                             | `webView.verticalScrollBarEnabled`                                       |
| `showsHorizontalScrollIndicator`   | `scrollView.<the same name>`                             | `webView.horizontalScrollBarEnabled`                                     |
| `javaScriptEnabled`                | `webpagePreferences.allowsContentJavaScript`             | `settings.<the same name>`                                               |
| `applicationNameForUserAgent`      | `configuration.<the same name>`                          | `settings.userAgentString` ([how][useragent])                            |
| `mediaPlaybackRequiresUserAction`  | `configuration.mediaTypesRequiringUserActionForPlayback` | `settings.mediaPlaybackRequiresUserGesture`                              |
| `contentMode`                      | `webpagePreferences.preferredContentMode`                |                                                                          |
| `decelerationRate`                 | `scrollView.<the same name>`                             |                                                                          |
| `cacheEnabled: false`              | `configuration.websiteDataStore: 'nonPersistent'`        | `settings.cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE`         |
| `automaticallyAdjustContentInsets` | `scrollView.contentInsetAdjustmentBehavior`              |                                                                          |
| `thirdPartyCookiesEnabled`         |                                                          | `webView.acceptThirdPartyCookies`                                        |
| `scalesPageToFit`                  |                                                          | `settings.useWideViewPort` and `settings.loadWithOverviewMode`           |
| `forceDarkOn`                      |                                                          | `settings.algorithmicDarkeningAllowed`; below `targetSdk` 33 `forceDark` |
| `saveFormDataDisabled`             |                                                          | `settings.saveFormData: false`, a no-op since API 26                     |
| `webviewDebuggingEnabled`          | `webView.inspectable`                                    | [`AndroidWebView.setWebContentsDebuggingEnabled()`][debugging], app-wide |
| `allowFileAccessFromFileURLs`      | `preferences.<the same name>`                            | `settings.<the same name>`                                               |
| `allowUniversalAccessFromFileURLs` | `configuration.<the same name>`                          | `settings.<the same name>`                                               |

A value keeps its form unless its key takes a constant:

- `mediaPlaybackRequiresUserAction={false}` is `IOSConstants.AudiovisualMediaTypes.none`, and `true` is `all`.
- `contentMode` is an `IOSConstants.ContentMode`.
- `decelerationRate` is a number: `0.998` for `'normal'`, `0.99` for `'fast'`.

## Props with no counterpart

| react-native-webview              | Why                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `autoManageStatusBarEnabled`      | iOS shows WebKit's own fullscreen                                                                                            |
| `useSharedProcessPool`            | `WKProcessPool` has had no effect since iOS 15                                                                               |
| `ignoreSilentHardwareSwitch`      | react-native-webview keeps a silent `<audio>` playing in the page for it                                                     |
| `enableApplePay`                  | Apple Pay works with injected scripts since iOS 16                                                                           |
| `lackPermissionToDownloadMessage` | `onDownload` saves into the app's cache, and [`downloadManager`][downloadmanager] into Downloads: neither needs a permission |

## What else changes

`onNavigationStateChange` keeps its name, but fires on every state change, progress and title included. `onLoadStart` and
`onLoadEnd` keep theirs too, and get the [`NavigationState`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/)
instead of a native event. `userAgent` is the same prop.

Remove the `LSApplicationQueriesSchemes` (iOS) and `<queries>` (Android) entries you added for the schemes a page opens
([`onOpenExternal`][onopenexternal]).

## onShouldStartLoadWithRequest

Navigation rules replace the callback, and the first rule that matches decides.

```tsx
import { WebView } from 'react-native-minimal-webview';

// Stands in for what your onShouldStartLoadWithRequest callback decided
const isTrusted = (url: string) => url.startsWith('https://example.com/');

export function Browser() {
  return (
    <WebView
      source={{ uri: 'https://example.com' }}
      navigationRules={[
        { host: ['example.com'], action: 'allow' },
        { scheme: ['http', 'https'], mainFrame: false, action: 'allow' }, // iframes
        { mainFrame: true, action: 'ask' }, // the rest: onNavigationRequest answers
      ]}
      onNavigationRequest={({ url }) => (isTrusted(url) ? 'allow' : 'block')}
      style={{ flex: 1 }}
    />
  );
}
```

Your rules replace the defaults, [`defaultNavigationRules`][defaultnavigationrules]: spread it after yours to keep them.
A navigation no rule matches is blocked, where react-native-webview opened a URL outside `originWhitelist` externally.

A rule decides natively, so a busy JS thread doesn't hold a navigation up. A late `onNavigationRequest` answer blocks
the navigation, where react-native-webview's Android let it through.

The [request](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationRequest/) has `mainFrame` in
place of `isTopFrame`, and `userInitiated` in place of `navigationType: 'click'`. It has no `mainDocumentURL`. A new
window (`onOpenWindow`) is a request with `newWindow: true`.

react-native-webview's iOS also asks about the `source` load, reloads, back/forward and form POSTs. The rules skip them
([`navigationRules`][navigationrules]).

After the rules block a server redirect, the state is the page before it, with [`outcome`][outcome] `cancelled`.

## injectJavaScript

`evaluate` takes an expression, not statements, and resolves with its value
([`evaluate`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#evaluate)).

Wrap the statements you passed `injectJavaScript` in a function you call, without the trailing `true;`, as in the
[scripts example](examples.md#scripts).

## postMessage and onMessage

The [bridge](examples.md#the-bridge) replaces both, with calls that return promises, and events, in both directions. It
serves only the origins you allow.

Pages that use `window.ReactNativeWebView.postMessage` and `message` events keep working with
[`reactNativeWebViewMessages`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/variables/reactNativeWebViewMessages/)
in `injectedScripts`, so the app can move first and the pages later. The bridge event `rnw` carries the messages both
ways:

```tsx
import { useEffect, useMemo } from 'react';
import { WebView, createBridge, reactNativeWebViewMessages } from 'react-native-minimal-webview';

type Messages = { reactNative: {}; page: {}; events: { rnw: string } };

export function Shop({ token }: { token: string }) {
  const bridge = useMemo(
    () => createBridge<Messages>({ allowedOrigins: ['https://example.com'] }),
    []
  );

  useEffect(
    () =>
      // onMessage: the page called window.ReactNativeWebView.postMessage(data)
      bridge.on('rnw', (data) => {
        const message = JSON.parse(data) as { type: string };
        // postMessage: the page gets a message event whose data is this string
        if (message.type === 'getToken')
          bridge.emit('rnw', JSON.stringify({ type: 'token', token }));
      }),
    [bridge, token]
  );

  return (
    <WebView
      source={{ uri: 'https://example.com' }}
      bridge={bridge}
      injectedScripts={[reactNativeWebViewMessages]}
      style={{ flex: 1 }}
    />
  );
}
```

## Scroll position

An injected script can report the main frame's scroll position over the bridge, at most once per frame. For the offsets
during a bounce or a pinch too, use the [`onScroll`][onscroll] extension.

```ts
import type { InjectedScript } from 'react-native-minimal-webview';

export const scrollScript: InjectedScript = {
  code: `{ // a block: an origins ['*'] script shares the page's global scope
  let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; window.nativeBridge?.emit('scroll', { x: scrollX, y: scrollY }); });
  }, { passive: true });
}`,
  origins: ['*'], // nativeBridge exists only on the bridge's allowedOrigins
};
```

Pass it in `injectedScripts` and listen with `bridge.on('scroll', …)`, as in the [bridge example](examples.md#the-bridge).

[defaultnavigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/variables/defaultNavigationRules/
[onfullscreenchange]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onfullscreenchange
[ondownload]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#ondownload
[recovered]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/ProcessGoneEvent/#recovered
[newwindow]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationRule/#newwindow
[outcome]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#outcome
[debugging]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/AndroidWebView/functions/setWebContentsDebuggingEnabled/
[onprocessgone]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onprocessgone
[onfilerequest]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onfilerequest
[onpermissionrequest]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onpermissionrequest
[onopenexternal]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onopenexternal
[navigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules
[useragent]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#useragent
[basicauthcredential]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/basicAuthCredential/
[incognito]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/incognito/
[menuitems]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/menuItems/
[onscroll]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/onScroll/
[transparentbackground]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/transparentBackground/
[hidekeyboardaccessoryview]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/hideKeyboardAccessoryView/
[keyboarddisplayrequiresuseraction]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/keyboardDisplayRequiresUserAction/
[refreshcontrollightmode]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/refreshControlLightMode/
[removeioskeyboardobserver]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/removeIosKeyboardObserver/
[nestedscrollenabled]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/nestedScrollEnabled/
[androidlayertype]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/androidLayerType/
[downloadmanager]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/downloadManager/
[onloadsubresourceerror]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/onLoadSubResourceError/
[dialogs]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/dialogs/
