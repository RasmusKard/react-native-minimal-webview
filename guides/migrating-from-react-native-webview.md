---
title: Migrating from react-native-webview
---

# Migrating from react-native-webview

This page maps each react-native-webview prop to its counterpart here, and lists the defaults and behavior that
differ and recipes for what has no prop. The [requirements](../README.md#requirements) are in the README.

Most props are platform settings by the same name: `bounces` is `ios={{ scrollView: { bounces: false } }}`, and
`textZoom` is `android={{ settings: { textZoom: 120 } }}`. Android keys are setter names without `set`, so
`setBuiltInZoomControls` is `android.settings.builtInZoomControls`.

The keys autocomplete, and an enum string becomes a constant: `cacheMode: 'LOAD_NO_CACHE'` is
`AndroidConstants.WebSettings.LOAD_NO_CACHE` ([platform settings](examples.md#platform-settings)).

## Defaults that differ

| | react-native-webview | Here | For react-native-webview's |
|---|---|---|---|
| Android overscroll | Always | The platform's | `android.webView.overScrollMode: 0` |
| iOS inline video | Off | On | `ios.configuration.allowsInlineMediaPlayback: false` |
| iOS AirPlay | Off | On | `ios.configuration.allowsAirPlayForMediaPlayback: false` |
| iOS content insets | `never`, indicators not adjusted | `automatic`, indicators adjusted | Two `ios.scrollView` keys, below |
| iOS debugging (`webviewDebuggingEnabled`) | Off | On in `__DEV__` | `ios.webView.inspectable: false` |

The same settings in one object, debugging left on:

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

| | react-native-webview | Here | For react-native-webview's |
|---|---|---|---|
| Android fullscreen video (`allowsFullscreenVideo`) | Off | On ([`onFullscreenChange`][onfullscreenchange]) | A native hook that takes `onShowCustomView` |
| iOS universal links | Open the app that claims them | Load in place | An `external` rule for the host |
| Downloads | Android: saved to Downloads | Open externally, or [`onDownload`][ondownload] saves them | A native hook's `onDownloadStart` (Android) |
| Renderer crash | Reported | The core reloads ([`onProcessGone`][onprocessgone]) | Keep `reload()` only for [`recovered: false`][recovered] |
| Messaging | Every page; on Android every frame | `allowedOrigins`, main frame | An iframe's: a native hook |
| Injected script | Document end, every origin | Document start, its `origins` | `addEventListener('DOMContentLoaded', …)`; `origins: ['*']` |
| Failed load | An error view over the page | iOS keeps the old page, Android shows its own | The [error screen](#loading-and-error-screens) |
| Android file input | Offers the camera when the app has its permission | The system chooser, which ignores `capture` | [`onFileRequest`][onfilerequest] |
| Android camera and microphone, and location with `geolocationEnabled` | Granted to every page, after asking the OS | Denied | [`onPermissionRequest`][onpermissionrequest] |

## Props that became something else

| react-native-webview | Here |
|---|---|
| `onShouldStartLoadWithRequest`, `originWhitelist`, `onOpenWindow` | `navigationRules` ([below](#onshouldstartloadwithrequest)) |
| `injectedJavaScript`, `injectedJavaScriptBeforeContentLoaded`, `injectedJavaScriptObject` | `injectedScripts` |
| `…ForMainFrameOnly: false` | `allFrames: true` on the script |
| `injectJavaScript(code)` | `evaluate(expression)` ([below](#injectjavascript)) |
| `onMessage`, `postMessage`, `window.ReactNativeWebView` | The bridge ([below](#postmessage-and-onmessage)) |
| `onLoad` | `onLoadEnd`, with `state.outcome === 'finished'` |
| `onLoadProgress` | `progress` in `useWebViewState` |
| `onError`, `onHttpError` | `onError`, whose `kind` is `'network'`, `'ssl'` or `'http'` |
| `onContentProcessDidTerminate`, `onRenderProcessGone` | `onProcessGone` |
| `renderLoading`, `renderError`, `startInLoadingState` | Your own views ([below](#loading-and-error-screens)) |
| `onContentSizeChange` | An injected script, as for the [scroll position](#scroll-position) |
| `source={require('./page.html')}` | A `file://` URI from expo-asset ([local files](examples.md#local-files)) |
| `allowingReadAccessToURL` | `source.readAccessRoot` |
| `source.method`, `source.body` | `source.body`, which makes the request a POST |
| `onFileDownload` | `onDownload`, on both platforms |
| `sharedCookiesEnabled`, `pullToRefreshEnabled` | `sharedCookies`, `pullToRefresh` |
| `mediaCapturePermissionGrantType`, `geolocationEnabled`, `allowsProtectedMedia` | `onPermissionRequest` |
| `clearCache(true)`, `clearHistory`, `clearFormData`, `requestFocus` | `call('webView.clearCache', [true])` and so on, on Android |
| `incognito` | `ios.configuration.websiteDataStore: 'nonPersistent'`; Android [below](#incognito) |
| `removeIosKeyboardObserver` | A [native hook](native-hooks.md) |
| `refreshControlLightMode`, `downloadingMessage`, `onLoadSubResourceError`, `nativeConfig` | A native hook |
| `containerStyle` | A `View` around the WebView |

On iOS, react-native-webview's `clearCache`, `clearHistory` and `clearFormData` do nothing under the new architecture.
WebKit's data store clears with `call` ([reading and calling](examples.md#reading-and-calling)).

These props are functions of
[@react-native-minimal-webview/extensions](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/), which
has the setup. You pass each one in the `extensions` prop:

| react-native-webview | Here |
|---|---|
| `basicAuthCredential` | [`basicAuthCredential`][basicauthcredential] |
| `menuItems`, `suppressMenuItems`, `onCustomMenuSelection` | [`menuItems`][menuitems] |
| `onScroll` | [`onScroll`][onscroll] |
| `hideKeyboardAccessoryView` | [`hideKeyboardAccessoryView`][hidekeyboardaccessoryview] |
| `keyboardDisplayRequiresUserAction` | [`keyboardDisplayRequiresUserAction`][keyboarddisplayrequiresuseraction] |
| `nestedScrollEnabled` | [`nestedScrollEnabled`][nestedscrollenabled] |
| `androidLayerType` | [`androidLayerType`][androidlayertype] |
| JS dialogs (no prop) | [`dialogs`][dialogs] |

The settings with another name:

| react-native-webview | `ios` | `android` |
|---|---|---|
| `scrollEnabled` | `scrollView.scrollEnabled` | |
| `showsVerticalScrollIndicator` | `scrollView.<the same name>` | `webView.verticalScrollBarEnabled` |
| `showsHorizontalScrollIndicator` | `scrollView.<the same name>` | `webView.horizontalScrollBarEnabled` |
| `javaScriptEnabled` | `webpagePreferences.allowsContentJavaScript` | `settings.<the same name>` |
| `applicationNameForUserAgent` | `configuration.<the same name>` | `settings.userAgentString` ([how][useragent]) |
| `mediaPlaybackRequiresUserAction` | `configuration.mediaTypesRequiringUserActionForPlayback` | `settings.mediaPlaybackRequiresUserGesture` |
| `contentMode` | `webpagePreferences.preferredContentMode` | |
| `cacheEnabled: false` | `configuration.websiteDataStore: 'nonPersistent'` | `settings.cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE` |
| `automaticallyAdjustContentInsets` | `scrollView.contentInsetAdjustmentBehavior` | |
| `thirdPartyCookiesEnabled` | | `webView.acceptThirdPartyCookies` |
| `scalesPageToFit` | | `settings.useWideViewPort` and `settings.loadWithOverviewMode` |
| `forceDarkOn` | | `settings.algorithmicDarkeningAllowed`; below `targetSdk` 33 `forceDark` |
| `saveFormDataDisabled` | | `settings.saveFormData: false`, a no-op since API 26 |
| `webviewDebuggingEnabled` | `webView.inspectable` | [`AndroidWebView.setWebContentsDebuggingEnabled()`][debugging], app-wide |
| `allowFileAccessFromFileURLs` | `preferences.<the same name>` | `settings.<the same name>` |
| `allowUniversalAccessFromFileURLs` | `configuration.<the same name>` | `settings.<the same name>` |
| `style={{ backgroundColor: 'transparent' }}` | `call('webView.setOpaque:', [false])` after each mount and `configuration` or `bridge` change ([why][iossettings]) | `webView.other.backgroundColor: 0` |

## Props with no counterpart

| react-native-webview | Why |
|---|---|
| `autoManageStatusBarEnabled` | iOS shows WebKit's own fullscreen |
| `useSharedProcessPool` | `WKProcessPool` has had no effect since iOS 15 |
| `ignoreSilentHardwareSwitch` | react-native-webview keeps a silent `<audio>` playing in the page for it |
| `enableApplePay` | Apple Pay works with injected scripts since iOS 16 |
| `lackPermissionToDownloadMessage` | A download lands in the app's cache, which needs no permission |

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

A rule decides natively, so a busy JS thread doesn't hold a navigation up. react-native-webview's Android blocks the UI
thread while it waits for the callback, and lets the navigation through when the callback is late. Its iOS waits
for the answer.

The [request](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationRequest/) has `mainFrame` in
place of `isTopFrame`, and `userInitiated` in place of `navigationType: 'click'`. It has no `mainDocumentURL`. A new
window (`onOpenWindow`) is a request with `newWindow: true`.

react-native-webview's iOS also asks about the `source` load, reloads, back/forward and form POSTs. The rules skip them
([`navigationRules`][navigationrules]).

After the rules block a server redirect, the state is the page before it, with [`outcome`][outcome] `cancelled`.
react-native-webview reports the redirecting URL as still loading (iOS), or the blocked URL as loaded (Android).

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
in `injectedScripts`. Its example shows what replaces `onMessage` and `postMessage`.

## incognito

On iOS, a non-persistent data store keeps the WebView's cookies, cache and storage, and they go with the WebView.

Android has no incognito WebView. react-native-webview's `incognito` clears the app-wide cookies, the cache, the
history and the form data, turns the cache off, and turns password and form-data saving off. This recipe clears the
cookies and the cache and turns the cache off before the page loads. A new WebView has no history, WebView doesn't save
form data since API 26, and password saving is deprecated.

The first `source` is blank, as for [cookies before the first page](examples.md#before-the-first-page):

```tsx
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  AndroidConstants,
  WebView,
  type WebViewRef,
  type WebViewSource,
} from 'react-native-minimal-webview';

export function PrivateBrowser() {
  const ref = useRef<WebViewRef>(null);
  const [source, setSource] = useState<WebViewSource>({ uri: 'about:blank' });

  useEffect(() => {
    (async () => {
      if (Platform.OS === 'android') {
        await ref.current?.call('cookieManager.removeAllCookies'); // app-wide, as in react-native-webview
        await ref.current?.call('webView.clearCache', [true]);
      }
      setSource({ uri: 'https://example.com' });
    })();
  }, []);

  return (
    <WebView
      ref={ref}
      source={source}
      ios={{ configuration: { websiteDataStore: 'nonPersistent' } }}
      android={{ settings: { cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE } }}
      style={{ flex: 1 }}
    />
  );
}
```

## Loading and error screens

Draw the loading and error views yourself, over the WebView, from the navigation state and `onError`:

```tsx
import { useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import {
  WebView,
  useWebViewState,
  type LoadErrorEvent,
  type WebViewRef,
} from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const { loading } = useWebViewState(ref);
  const [error, setError] = useState<LoadErrorEvent | null>(null);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={ref}
        source={{ uri: 'https://example.com' }}
        onError={(e) => e.kind !== 'http' && setError(e)} // on 'http' the site's own error page shows
        onLoadStart={() => setError(null)}
        style={{ flex: 1 }}
      />
      {error ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text>Could not load the page</Text>
          <Button title="Retry" onPress={() => ref.current?.reload()} />
        </View>
      ) : loading ? (
        <ActivityIndicator style={StyleSheet.absoluteFill} />
      ) : null}
    </View>
  );
}
```

## Scroll position

An injected script can report the main frame's scroll position over the bridge, at most once per frame. For the offsets
during a bounce or a pinch too, use the [`onScroll`][onscroll] extension.

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { WebView, createBridge, type InjectedScript } from 'react-native-minimal-webview';

const scrollScript: InjectedScript = {
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

export function Browser() {
  const bridge = useMemo(() => createBridge({ allowedOrigins: ['https://example.com'] }), []);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });

  useEffect(() => bridge.on('scroll', (position) => setScroll(position as { x: number; y: number })), [bridge]);

  return (
    <>
      <Text>{scroll.y}</Text>
      <WebView
        source={{ uri: 'https://example.com' }}
        bridge={bridge}
        injectedScripts={[scrollScript]}
        style={{ flex: 1 }}
      />
    </>
  );
}
```

[defaultnavigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/variables/defaultNavigationRules/
[onfullscreenchange]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onfullscreenchange
[ondownload]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#ondownload
[recovered]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/ProcessGoneEvent/#recovered
[outcome]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#outcome
[debugging]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/AndroidWebView/functions/setWebContentsDebuggingEnabled/
[onprocessgone]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onprocessgone
[onfilerequest]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onfilerequest
[onpermissionrequest]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onpermissionrequest
[onopenexternal]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onopenexternal
[navigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules
[useragent]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#useragent
[iossettings]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/
[basicauthcredential]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/basicAuthCredential/
[menuitems]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/menuItems/
[onscroll]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/onScroll/
[hidekeyboardaccessoryview]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/hideKeyboardAccessoryView/
[keyboarddisplayrequiresuseraction]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/keyboardDisplayRequiresUserAction/
[nestedscrollenabled]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/nestedScrollEnabled/
[androidlayertype]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/androidLayerType/
[dialogs]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/dialogs/
