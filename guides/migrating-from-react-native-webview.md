# Migrating from react-native-webview

This guide gives each react-native-webview prop's counterpart here, and the defaults and behavior that differ. The
[requirements](../README.md#requirements) are in the README.

The [migration skill](../skills/migrate-from-react-native-webview/SKILL.md) has a coding agent migrate an app with this
guide, verify the result and report what changed. Add it with:

```sh
npx skills add RasmusKard/react-native-minimal-webview --skill migrate-from-react-native-webview
```

Most props are platform settings by the same name: `bounces` is `ios={{ scrollView: { bounces: false } }}`, and
`textZoom` is `android={{ settings: { textZoom: 120 } }}`. An enum string becomes a constant: `cacheMode: 'LOAD_NO_CACHE'`
is `AndroidConstants.WebSettings.LOAD_NO_CACHE`. For a prop no table here lists, find its key in [Use a platform API](platform-apis.md).

## Defaults that differ

|                                           | react-native-webview             | Here                                          | To get the old behavior                                                           |
| ----------------------------------------- | -------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Android overscroll                        | Always                           | The platform's                                | `android.webView.overScrollMode: 0`                                               |
| iOS inline video                          | Off                              | On                                            | `ios.configuration.allowsInlineMediaPlayback: false`                              |
| iOS AirPlay                               | Off                              | On                                            | `ios.configuration.allowsAirPlayForMediaPlayback: false`                          |
| iOS data detectors (`dataDetectorTypes`)  | Phone numbers                    | None                                          | `ios.configuration.dataDetectorTypes: IOSConstants.DataDetectorTypes.phoneNumber` |
| iOS content insets                        | `never`, indicators not adjusted | `automatic`, indicators adjusted              | Two `ios.scrollView` keys, below                                                  |
| iOS debugging (`webviewDebuggingEnabled`) | Off                              | On in `__DEV__`                               | `ios.webView.inspectable: false`                                                  |
| Android back-forward cache                | Off                              | On, with Android System WebView 146 and newer | `android.settings.backForwardCacheEnabled: false`                                 |

This object restores the old defaults. It leaves debugging and the back-forward cache on:

```tsx
import { IOSConstants, WebView, type WebViewProps } from 'react-native-minimal-webview';

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

|                                                                       | react-native-webview                                                         | Here                                                       | To get the old behavior                                                                                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android fullscreen video (`allowsFullscreenVideo`)                    | Off                                                                          | On ([`onFullscreenChange`][onfullscreenchange])            | A native hook that takes `onShowCustomView`                                                                                                        |
| iOS universal links                                                   | Open the app that claims them                                                | Load in place                                              | A native hook that decides navigations itself, or an `external` rule for the host, which opens its app, or the browser when no app claims the link |
| Downloads                                                             | Saved to Downloads on Android                                                | Open externally, or [`onDownload`][ondownload] saves them  | [`downloadManager`][downloadmanager] (Android)                                                                                                     |
| Renderer crash                                                        | Reported                                                                     | The core reloads ([`onProcessGone`][onprocessgone])        | Remove your `reload()`, and offer a retry while [`recovered`][recovered] is false                                                                  |
| Messaging                                                             | Every page, and on Android every frame                                       | The main frame, on `allowedOrigins`                        | For an iframe, a native hook                                                                                                                       |
| Injected script                                                       | At document end on iOS, once the page has loaded on Android, on every origin | At document start, on its `origins`                        | `addEventListener('DOMContentLoaded', …)`, or `'load'` for Android's timing, and `origins: ['*']`                                                  |
| Failed load                                                           | An error view over the page                                                  | iOS keeps the old page, Android shows its own              | The [error screen](examples.md#loading-and-error-screens)                                                                                          |
| Android file input                                                    | Offers the camera, and with `capture` opens it directly                      | The system chooser, which ignores `capture`                | [`onFileRequest`][onfilerequest]                                                                                                                   |
| Android camera and microphone, and location with `geolocationEnabled` | Granted to every page, after asking the OS                                   | Denied                                                     | [`onPermissionRequest`][onpermissionrequest]                                                                                                       |
| A link to another scheme (`tel:`, `myapp:`)                           | Opens externally                                                             | Only from the main frame, after a user gesture             | An `external` rule for the scheme                                                                                                                  |
| New window (`target=_blank`, `window.open`)                           | In place on iOS, in the system browser on Android                            | In place, when a rule allows it ([`newWindow`][newwindow]) | `{ newWindow: true, action: 'external' }`                                                                                                          |
| Android System WebView older than 101                                 | Messaging and injected scripts work                                          | Neither does ([versions](android-system-webview.md))       |                                                                                                                                                    |

Remove the `LSApplicationQueriesSchemes` (iOS) and `<queries>` (Android) entries you added for the schemes a page opens,
unless your own code calls `Linking.canOpenURL` for them. The core opens those links without asking `canOpenURL`
([`onOpenExternal`][onopenexternal]).

## Props that became something else

| react-native-webview                                                                           | Here                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `onShouldStartLoadWithRequest`, `originWhitelist`, `onOpenWindow`, `setSupportMultipleWindows` | `navigationRules` ([below](#onshouldstartloadwithrequest))                                                                |
| `injectedJavaScript`, `injectedJavaScriptBeforeContentLoaded`, `injectedJavaScriptObject`      | `injectedScripts`                                                                                                         |
| `…ForMainFrameOnly: false`                                                                     | `allFrames: true` on the script                                                                                           |
| `injectJavaScript(code)`                                                                       | `evaluate(expression)` ([below](#injectjavascript))                                                                       |
| `injectJavaScript('window.location = …')`, a new `source` to navigate                          | `load(url)`                                                                                                               |
| `onMessage`, `postMessage`, `window.ReactNativeWebView`                                        | The bridge ([below](#postmessage-and-onmessage))                                                                          |
| `onLoad`                                                                                       | `onLoadEnd`, with `state.outcome === 'finished'`                                                                          |
| `onLoadProgress`                                                                               | `progress` in `useWebViewState`                                                                                           |
| `onError`, `onHttpError`                                                                       | `onError`, whose `kind` is `'network'`, `'ssl'` or `'http'`                                                               |
| `onContentProcessDidTerminate`, `onRenderProcessGone`                                          | `onProcessGone`, whose `cause` is `'crash'`, `'memory'` or, on iOS, `'unknown'`                                           |
| `renderLoading`, `renderError`, `startInLoadingState`                                          | [Your own views](examples.md#loading-and-error-screens), shown on every load                                              |
| `onContentSizeChange`                                                                          | An injected script, as for the [scroll position](#scroll-position)                                                        |
| `ignoreSilentHardwareSwitch`                                                                   | An injected script that sets `navigator.audioSession.type = 'playback'`                                                   |
| `source={require('./page.html')}`                                                              | A `file://` URI from expo-asset ([local files](examples.md#local-files))                                                  |
| `allowingReadAccessToURL`                                                                      | `source.readAccessRoot`                                                                                                   |
| `source.method`, `source.body`                                                                 | `source.body`, which makes the request a POST                                                                             |
| `onFileDownload`                                                                               | `onDownload`, on both platforms, which gets the saved file instead of a URL to fetch                                      |
| `sharedCookiesEnabled`, `pullToRefreshEnabled`                                                 | `sharedCookies`, `pullToRefresh`                                                                                          |
| `mediaCapturePermissionGrantType`, `geolocationEnabled`, `allowsProtectedMedia`                | `onPermissionRequest`                                                                                                     |
| `clearCache(true)`, `clearHistory`, `clearFormData`, `requestFocus`                            | Android: `call('webView.clearCache', [true])` and so on. iOS: [`call` on the data store](examples.md#reading-and-calling) |
| `nativeConfig`                                                                                 | A [native hook](native-hooks.md)                                                                                          |
| Props from a helper (`{...Sentry.sentryWebViewProps()}`)                                       | Each prop it returns, by its own row: its `injectedJavaScriptBeforeContentLoaded` is an `injectedScripts` entry           |
| `containerStyle`                                                                               | A `View` around the WebView                                                                                               |

`onError` has no `domain`. On iOS it also reports a load that fails after it committed, which react-native-webview
didn't, and an Android `ssl` error's `description` differs ([`LoadErrorEvent`][loaderrorevent]).

### Props that became extensions

These props are functions of [@react-native-minimal-webview/extensions][extensions], whose page has the setup. Pass each
one in the `extensions` prop. A callback gets the event itself, without a `nativeEvent` around it.

| react-native-webview                                      | Here                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `basicAuthCredential`                                     | [`basicAuthCredential`][basicauthcredential]                                          |
| `incognito`                                               | [`incognito`][incognito]                                                              |
| `menuItems`, `suppressMenuItems`, `onCustomMenuSelection` | [`menuItems`][menuitems]                                                              |
| `onScroll`                                                | [`onScroll`][onscroll]                                                                |
| `style={{ backgroundColor: 'transparent' }}`              | [`transparentBackground`][transparentbackground]                                      |
| `hideKeyboardAccessoryView`                               | [`hideKeyboardAccessoryView`][hidekeyboardaccessoryview]                              |
| `keyboardDisplayRequiresUserAction`                       | [`keyboardDisplayRequiresUserAction`][keyboarddisplayrequiresuseraction]              |
| `refreshControlLightMode`                                 | [`refreshControlLightMode`][refreshcontrollightmode]                                  |
| `removeIosKeyboardObserver`                               | [`removeIosKeyboardObserver`][removeioskeyboardobserver]                              |
| `nestedScrollEnabled`                                     | [`nestedScrollEnabled`][nestedscrollenabled]                                          |
| `androidLayerType`                                        | [`androidLayerType`][androidlayertype]                                                |
| Android downloads, `downloadingMessage`                   | [`downloadManager`][downloadmanager]                                                  |
| `onLoadSubResourceError`                                  | [`onLoadSubResourceError`][onloadsubresourceerror], which reports network errors only |
| JS dialogs (no prop)                                      | [`dialogs`][dialogs]                                                                  |

### Settings with another name

| react-native-webview               | `ios`                                                    | `android`                                                                           |
| ---------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `scrollEnabled`                    | `scrollView.scrollEnabled`                               |                                                                                     |
| `showsVerticalScrollIndicator`     | `scrollView.<the same name>`                             | `webView.verticalScrollBarEnabled`                                                  |
| `showsHorizontalScrollIndicator`   | `scrollView.<the same name>`                             | `webView.horizontalScrollBarEnabled`                                                |
| `javaScriptEnabled`                | `webpagePreferences.allowsContentJavaScript`             | `settings.<the same name>`                                                          |
| `applicationNameForUserAgent`      | `configuration.<the same name>`                          | `settings.userAgentString` ([how][useragent])                                       |
| `mediaPlaybackRequiresUserAction`  | `configuration.mediaTypesRequiringUserActionForPlayback` | `settings.mediaPlaybackRequiresUserGesture`                                         |
| `contentMode`                      | `webpagePreferences.preferredContentMode`                |                                                                                     |
| `decelerationRate`                 | `scrollView.<the same name>`                             |                                                                                     |
| `cacheEnabled: false`              | `configuration.websiteDataStore: 'nonPersistent'`        | `settings.cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE`                    |
| `automaticallyAdjustContentInsets` | `scrollView.contentInsetAdjustmentBehavior`              |                                                                                     |
| `thirdPartyCookiesEnabled`         |                                                          | `webView.acceptThirdPartyCookies`                                                   |
| `scalesPageToFit`                  |                                                          | `settings.useWideViewPort` and `settings.loadWithOverviewMode`                      |
| `setBuiltInZoomControls`           |                                                          | `settings.builtInZoomControls`                                                      |
| `setDisplayZoomControls`           |                                                          | `settings.displayZoomControls`                                                      |
| `forceDarkOn`                      |                                                          | `settings.algorithmicDarkeningAllowed`, or `forceDark` when `targetSdk` is below 33 |
| `webviewDebuggingEnabled`          | `webView.inspectable`                                    | [`AndroidWebView.setWebContentsDebuggingEnabled()`][debugging], app-wide            |
| `allowFileAccessFromFileURLs`      | `preferences.<the same name>`                            | `settings.<the same name>`                                                          |
| `allowUniversalAccessFromFileURLs` | `configuration.<the same name>`                          | `settings.<the same name>`                                                          |

A value keeps its form unless its key takes a constant:

- `mediaPlaybackRequiresUserAction={false}` is `IOSConstants.AudiovisualMediaTypes.none`, and `true` is `all`.
- `contentMode` is an `IOSConstants.ContentMode`.
- `decelerationRate` is a number: `0.998` for `'normal'`, `0.99` for `'fast'`.

## Props with no counterpart

| react-native-webview              | Why                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `autoManageStatusBarEnabled`      | iOS shows WebKit's own fullscreen                                                                                                         |
| `useSharedProcessPool`            | Process pools have no effect on the iOS versions this package supports                                                                    |
| `enableApplePay`                  | Apple Pay works with injected scripts                                                                                                     |
| `saveFormDataDisabled`            | Android ignores `saveFormData` on the versions this package supports                                                                      |
| `lackPermissionToDownloadMessage` | Downloads need no permission, whether `onDownload` saves them into the app's cache or [`downloadManager`][downloadmanager] into Downloads |

## Props that keep their name

`onNavigationStateChange` keeps its name but fires on every state change, progress and title included. `onLoadStart` and
`onLoadEnd` keep theirs too, and get the [`NavigationState`][navigationstate] instead of a native event. `userAgent` is
the same prop.

react-native-webview's Android made a `User-Agent` in `source.headers` the WebView's user agent, so apps set it there in
place of `userAgent`. Here Android doesn't send that header ([`WebViewSource`][webviewsource]): move its value to the
`userAgent` prop.

## Migration recipes

### onShouldStartLoadWithRequest

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

Your rules replace the defaults, [`defaultNavigationRules`][defaultnavigationrules]. To keep the defaults, spread them
after your rules. A navigation that no rule matches is blocked, while react-native-webview opened a URL outside
`originWhitelist` externally.

A late `onNavigationRequest` answer blocks the navigation, where react-native-webview's Android let it through.

Keep `ask` for the navigations only your code can decide, and give the pages you always load an `allow` rule in front
of it, as above. Android here can't hold a navigation until JS answers: it cancels an asked
one and, when allowed, loads it again as a load the app starts. That load ignores the page's referrer policy, sends other
`Sec-Fetch-*` headers than the page's own navigation, and adds a history entry for a `location.replace` ([`action`][navigationruleaction]).

The [request][navigationrequest] has `mainFrame` in place of `isTopFrame`, and `userInitiated` in place of
`navigationType: 'click'`. It has no `mainDocumentURL`. A new window (`onOpenWindow`) is a request with
`newWindow: true`.

The rules skip the `source` load, reloads, back/forward and form POSTs. [`navigationRules`][navigationrules] lists every
navigation they skip.

### injectJavaScript

[`evaluate`][evaluate] takes an expression, not statements, and resolves with its value.

Wrap the statements you passed `injectJavaScript` in a function you call, without the trailing `true;`, as in the
[scripts example](examples.md#scripts).

Its promise rejects when the script throws, the page navigates away or the call can't run, where `injectJavaScript`
reported nothing: handle the rejection.

### postMessage and onMessage

The [bridge](examples.md#the-bridge) replaces both. Each side can send events and make calls that return promises.

Pages that use `window.ReactNativeWebView.postMessage` and `message` events keep working with
[`reactNativeWebViewMessages`][reactnativewebviewmessages] in `injectedScripts`, so the app can move first and the pages
later. The bridge event `rnw` carries the messages both ways:

```tsx
import { useEffect, useMemo } from 'react';
import { WebView, createBridge, reactNativeWebViewMessages } from 'react-native-minimal-webview';

type Messages = {
  reactNative: Record<never, never>;
  page: Record<never, never>;
  events: { rnw: string };
};

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

The listener's second argument, `{ origin }` ([`BridgeSender`][bridgesender]), takes the place of `nativeEvent.url` for
checking which page sent a message. It is an origin, without the path.

The reply waits for the page's `DOMContentLoaded`, where `postMessage` delivered at once:
[`reactNativeWebViewMessages`][reactnativewebviewmessages] says what that changes for a request the page sends.

### Scroll position

An injected script can report the main frame's scroll position over the bridge, at most once per animation frame. To
also get the offsets during a bounce or a pinch, use the [`onScroll`][onscroll] extension.

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
[navigationstate]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/
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
[extensions]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/
[navigationruleaction]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationRule/#action
[navigationrequest]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationRequest/
[webviewsource]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewSource/
[evaluate]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#evaluate
[reactnativewebviewmessages]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/variables/reactNativeWebViewMessages/
[loaderrorevent]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/LoadErrorEvent/
[bridgesender]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/BridgeSender/
