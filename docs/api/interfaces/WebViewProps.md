# Interface: WebViewProps

The WebView's props. The ones from React Native's `ViewProps` (`style`, `testID`, `nativeID`, the accessibility
props, layout and touch events) go to the native view. JS dialogs (`alert`, `confirm`, `prompt`) and HTTP auth have
no prop: iOS shows a `UIAlertController` titled with the frame's host, one at a time, and Android WebView's own
dialogs; an auth challenge is declined, so the site's 401 page shows. A native hook takes them over (`HookDialogs`
and `HookAuth` in `example/modules/sample-extension`).

## Extends

- `Omit`\<`ViewProps`, `"children"`\>

## Properties

### android?

> `optional` **android?**: [`AndroidSettings`](../type-aliases/AndroidSettings.md)

Android settings by setter name; see [AndroidSettings](../type-aliases/AndroidSettings.md). A key you remove keeps its value until the WebView is
recreated, unless the package sets it (`webContentsDebuggingEnabled`, `userAgentString`): that one goes back to the
package's default. The `userAgent` prop wins over the same key here.

#### Platform

android

***

### bridge?

> `optional` **bridge?**: [`Bridge`](../type-aliases/Bridge.md)\<[`BridgeMethodMap`](../type-aliases/BridgeMethodMap.md), [`BridgeEventMap`](../type-aliases/BridgeEventMap.md)\>

The bridge to the page, from `createBridge`. Read when the WebView is created: another bridge recreates it (the
page reloads and the navigation state starts over), so make it once (`useMemo`). A bridge serves one mounted
WebView at a time: attaching it to a second throws.

***

### hookOptions?

> `optional` **hookOptions?**: `Record`\<`string`, `unknown`\>

Each native hook's value by its key. A key whose value is not null, undefined or false when the WebView is created
attaches its hook, and a later change reaches that hook live, without recreating the WebView. A key added later
attaches nothing (a warning says so), so a hook you switch on and off keeps its key, with the switch in its value.
A key no hook is registered under warns: pass a one-platform hook's key on that platform only.

#### See

https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#native-hooks

***

### injectedScripts?

> `optional` **injectedScripts?**: [`InjectedScript`](../type-aliases/InjectedScript.md)[]

Scripts to run at document start, before the page's own, on every page and origin the WebView visits (and with
`mainFrameOnly: false` in cross-origin iframes): guard with `location.origin`. A change applies from the next
navigation. On Android with a WebView older than 101 they don't run (a warning says so, once per process).

***

### ios?

> `optional` **ios?**: [`IOSSettings`](../type-aliases/IOSSettings.md)

WebKit settings by property name; see [IOSSettings](../type-aliases/IOSSettings.md). A key you remove keeps its value until the WebView is
recreated, unless the package sets it (`inspectable`, `customUserAgent`): that one goes back to the package's
default. The `userAgent` prop wins over the same key here.

#### Platform

ios

***

### navigationRules?

> `optional` **navigationRules?**: [`NavigationRule`](../type-aliases/NavigationRule.md)[]

Which navigations load in place, open externally or are blocked, decided natively; the first matching rule wins,
and with no match the navigation is blocked. With no rules (or `[]`), http(s) loads in place, `file:` is blocked,
and other schemes open externally from the main frame and are blocked from a subframe. `about:`, `blob:`, `data:`
and `javascript:` always load in place. The `source` load, reloads and back/forward skip the rules; a redirect of
the `source` load doesn't, nor on Android a redirect of a reload or back/forward. On Android the rules never see a
POST: form posts always load, and a form POST to a new window doesn't load at all. iOS shows form POSTs to the
rules: an `external` one opens as a GET without its body, and one to a new window loads in place. An `external` `intent:` URL
(Android) opens only as a browsable intent, without its explicit component or selector; when no app handles it, its
`S.browser_fallback_url` goes through the rules and the `intent:` itself is reported as `block`.

#### See

https://github.com/RasmusKard/minimal-rn-webview/blob/main/docs/examples.md#navigation-rules

***

### onDownload?

> `optional` **onDownload?**: (`result`) => `void`

A download finished ([Download](../type-aliases/Download.md)) or failed ([DownloadFailure](../type-aliases/DownloadFailure.md)). With this prop the core saves the file:
iOS downloads it in the page's session; Android fetches it again with the host's cookies (whatever their SameSite)
and the page's user agent. That fetch sends no POST body, `source` headers or HTTP auth, so such a download can
fail or save a login page, and it fails above 100 MB, on a redirect off https, and for `blob:` on a WebView older
than 83. Without this prop, an http(s) download opens externally (`onOpenExternal` or the system browser, without
the page's session), and a `data:` or `blob:` one is dropped. A PDF is a download on Android; iOS shows it inline.

#### Parameters

##### result

[`Download`](../type-aliases/Download.md) \| [`DownloadFailure`](../type-aliases/DownloadFailure.md)

#### Returns

`void`

***

### onError?

> `optional` **onError?**: (`event`) => `void`

A main-frame load failed, or got an HTTP error status. On Android with a WebView older than 146, an SSL error on a
back/forward load isn't reported.

#### Parameters

##### event

[`LoadErrorEvent`](../type-aliases/LoadErrorEvent.md)

#### Returns

`void`

***

### onFileRequest?

> `optional` **onFileRequest?**: (`request`, `signal`) => `string`[] \| `Promise`\<`string`[] \| `null`\> \| `null`

Answers `<input type="file">` with `file://` or `content://` URIs, or null to cancel. Without it, the system file
chooser opens, one at a time for the whole app, and ignores `capture`: a request while one is open is cancelled,
and after a chooser that never returns a result, so is every request until the app restarts. iOS always shows
WebKit's picker, which needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`. `signal` aborts when
native stops waiting (the page moved on, crashed or unmounted), and a late answer is dropped; until it settles, the
page's next file request waits.

#### Parameters

##### request

[`FileRequest`](../type-aliases/FileRequest.md)

##### signal

`AbortSignal`

#### Returns

`string`[] \| `Promise`\<`string`[] \| `null`\> \| `null`

#### Platform

android

***

### onFullscreenChange?

> `optional` **onFullscreenChange?**: (`event`) => `void`

The page entered or left fullscreen (`active`). Fullscreen works without it: the page's view covers the window, the
system bars hide and back exits. iOS shows WebKit's own fullscreen, not reported.

#### Parameters

##### event

[`FullscreenChangeEvent`](../type-aliases/FullscreenChangeEvent.md)

#### Returns

`void`

#### Platform

android

***

### onHookEvent?

> `optional` **onHookEvent?**: (`event`, `signal?`) => `unknown`

An event from a native hook. For an `ask`, the return value (a promise is awaited) is the answer; `undefined` or a
throw answers null. `signal` is set only for an `ask`, and aborts when native stops waiting for the answer: an ask
has no timeout, but one still open when the page goes away is answered null.

#### Parameters

##### event

[`HookEvent`](../type-aliases/HookEvent.md)

##### signal?

`AbortSignal`

#### Returns

`unknown`

***

### onLoadEnd?

> `optional` **onLoadEnd?**: (`state`) => `void`

`loading` went false: `state.outcome` says how the load ended.

#### Parameters

##### state

[`NavigationState`](../type-aliases/NavigationState.md)

#### Returns

`void`

***

### onLoadStart?

> `optional` **onLoadStart?**: (`state`) => `void`

`loading` went true. On Android with a WebView older than 146, a load that never commits fires neither this nor
`onLoadEnd`.

#### Parameters

##### state

[`NavigationState`](../type-aliases/NavigationState.md)

#### Returns

`void`

***

### onNavigation?

> `optional` **onNavigation?**: (`event`) => `void`

Every navigation the rules, or their defaults, decided. Not reported: the `source` load, reloads, back/forward, and
a navigation a native hook decides.

#### Parameters

##### event

[`NavigationEvent`](../type-aliases/NavigationEvent.md)

#### Returns

`void`

***

### onNavigationRequest?

> `optional` **onNavigationRequest?**: (`request`, `signal`) => [`NavigationAction`](../type-aliases/NavigationAction.md) \| `Promise`\<[`NavigationAction`](../type-aliases/NavigationAction.md)\>

Answers `ask` rules within 1 s. A late, missing or other answer is `block`, as is one still pending when another
page commits, and `signal` then aborts. Without this prop, `ask` is `block`. Until the next commit, a URL it
allowed isn't asked again on a redirect back to it (Android), or when the same kind of frame loads it again (iOS).

#### Parameters

##### request

[`NavigationRequest`](../type-aliases/NavigationRequest.md)

##### signal

`AbortSignal`

#### Returns

[`NavigationAction`](../type-aliases/NavigationAction.md) \| `Promise`\<[`NavigationAction`](../type-aliases/NavigationAction.md)\>

***

### onNavigationStateChange?

> `optional` **onNavigationStateChange?**: (`state`) => `void`

Every change to the navigation state. Changes within one frame are combined into one call.

#### Parameters

##### state

[`NavigationState`](../type-aliases/NavigationState.md)

#### Returns

`void`

***

### onOpenExternal?

> `optional` **onOpenExternal?**: (`url`) => `void`

Opens `external` navigations, every one, an Android `intent:` URL included (its fallback URL is not loaded).
Default: the system browser or app for the URL.

#### Parameters

##### url

`string`

#### Returns

`void`

***

### onPermissionRequest?

> `optional` **onPermissionRequest?**: (`request`, `signal`) => `boolean` \| `Promise`\<`boolean`\>

Camera, microphone and, on Android, location and protected media (DRM) for the main frame. Answer true to grant,
having asked the OS first (expo-camera, expo-location): without OS permission the page's request fails anyway. On
iOS, true also skips WebKit's own prompt. Without this prop, Android denies and iOS shows WebKit's prompt (location
always does). Android keeps a location answer until the page changes. `signal` aborts when native stops waiting
(the page moved on, crashed or unmounted, or Android withdrew the request), and a late answer is dropped; until it
settles, the page's next request of the same kind waits.

#### Parameters

##### request

[`PermissionRequest`](../type-aliases/PermissionRequest.md)

##### signal

`AbortSignal`

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### onProcessGone?

> `optional` **onProcessGone?**: (`event`) => `void`

The renderer died; see [ProcessGoneEvent](../type-aliases/ProcessGoneEvent.md) for the recovery. Android's WebViews share one renderer, so each of
them reports its death.

#### Parameters

##### event

[`ProcessGoneEvent`](../type-aliases/ProcessGoneEvent.md)

#### Returns

`void`

***

### pullToRefresh?

> `optional` **pullToRefresh?**: `boolean`

Pull down at the top of the page to reload: `UIRefreshControl` on iOS, `SwipeRefreshLayout` on Android, where a
pull inside a scrolled inner scroller (`overflow: auto`) scrolls it instead.

#### Default

```ts
false
```

***

### ref?

> `optional` **ref?**: `Ref`\<[`WebViewRef`](../type-aliases/WebViewRef.md)\>

Gets the [WebViewRef](../type-aliases/WebViewRef.md). A ref object (`useRef`, `createRef`, `createWebViewRef`) also works with
`useWebViewState`. Give each mounted WebView its own ref: with two, the last mounted wins (with a warning in
development) until it unmounts.

***

### sharedCookies?

> `optional` **sharedCookies?**: `boolean`

Copies `HTTPCookieStorage` (native requests) into the WebView before each `source` load, which waits for it, and
the WebView's cookie changes, deletions included, back as they happen. Android needs nothing: `CookieManager` is
shared app-wide, and flushed when the app goes to the background.

#### Platform

ios

#### Default

```ts
false
```

***

### source

> **source**: [`WebViewSource`](../type-aliases/WebViewSource.md)

What to load. A new `source` loads at once, unless it equals the loaded one field by field: that loads nothing,
even after the page navigated away.

***

### userAgent?

> `optional` **userAgent?**: `string`

Replaces the whole user agent (`ios.webView.customUserAgent`, `android.settings.userAgentString`). To append to
the default one instead, set `ios.configuration.applicationNameForUserAgent` and, on Android,
`android.settings.userAgentString` to `WebView.defaultUserAgent` plus your suffix.
