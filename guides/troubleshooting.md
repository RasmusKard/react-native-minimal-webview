# Troubleshooting

Symptoms, their usual causes in this package, and the reference entry that has the full rule.

## Read the warnings first

The core skips what it can't apply and says so, instead of failing. Its warnings are `console.warn` messages that start
with `[react-native-minimal-webview]`, so they show wherever your app's JS logs do. A few go to the device log only, on
Android under the logcat tag `MinimalWebView`.

For a navigation, [`onNavigation`][onnavigation] reports each decision and the index of the rule that made it:
`onNavigation={({ url, action, rule }) => console.log(action, url, rule)}`.

## `window.nativeBridge` is undefined

- The page's origin isn't in the bridge's [`allowedOrigins`][allowedorigins]. `https://*.example.com` matches subdomains
  only, not `https://example.com`, and a port is part of the origin. `await ref.current?.evaluate('location.origin')`
  shows what the page has.
- The script runs in an iframe: only the main frame gets the bridge.
- The WebView has no [`bridge`][bridge] prop.
- Android System WebView is older than 101, which a warning says:
  [check the device's version](android-system-webview.md#check-a-devices-webview).
- The page is open in a browser, not in the app.

## A link does nothing, or opens outside the app

- No rule matched it, so it was blocked: `onNavigation` reports `rule: null`. Your
  [`navigationRules`][navigationrules] replace [`defaultNavigationRules`][defaultnavigationrules] unless you spread
  them in.
- It goes to another scheme (`myapp:`, `tel:`) without a user gesture, which the default rules block. A redirect to
  `myapp://callback` at the end of a sign-in is the common case: add `{ scheme: ['myapp'], action: 'external' }` before
  the defaults.
- A host wildcard skipped the bare domain: list `example.com` and `*.example.com`.
- A malformed rule blocks every navigation that reaches it. A warning names it in development.
- On iOS a tapped universal link loads in place when a rule allows it. An `external` rule for its host opens the app
  that claims it.

## The camera, microphone or location is denied

- Android denies every request without [`onPermissionRequest`][onpermissionrequest].
- The OS permission is missing: answering true doesn't grant it, so ask the OS first.
- The request comes from an iframe (on Android, one of another origin than the main frame's), or from a page with an
  opaque origin: those are denied without asking.
- On iOS, location never reaches `onPermissionRequest`: WebKit shows its own prompt.

## A download does nothing

- Without [`onDownload`][ondownload], an http(s) download opens in the system browser, without the page's session,
  and a `data:` or `blob:` one is dropped.
- With it, Android fetches the file again, without the request's POST body, `source` headers or HTTP auth: a download
  that needs them fails, or saves the server's login page.

## A setting has no effect

- The key was skipped, with a warning: its value doesn't fit the property's type, or the device's iOS or WebView lacks
  it.
- It is an [`ios.webpagePreferences`][iossettings] key, which applies from the next navigation.
- UIKit declares the property without runtime metadata, as it does `webView.opaque`: set it with
  [`call`](platform-apis.md#4-call-a-method).
- It is Android's `webContentsDebuggingEnabled`, which is process-wide: use
  [`AndroidWebView.setWebContentsDebuggingEnabled`][debugging].

## The page reloads, or the navigation state starts over

- The `bridge` prop got a new bridge. `createBridge` inside the component makes one on every render: wrap it in
  `useMemo`. A warning says so in development.
- A value in [`ios.configuration`][iossettings] changed.
- The renderer crashed and the core reloaded the page: [`onProcessGone`][onprocessgone] reports it.

## An injected script doesn't run, or fails

- The frame's origin isn't in the script's [`origins`][injectedscript], or the frame is an iframe and the script has no
  `allFrames`.
- It touches `document.body`, which doesn't exist yet at document start: wait for `DOMContentLoaded`.
- The page can't see what it declared: without `'*'` in `origins` the code runs inside a function, so put what the page
  should see on `window`.
- Android System WebView is older than 101.

[onnavigation]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onnavigation
[allowedorigins]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/BridgeOptions/#allowedorigins
[bridge]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#bridge
[navigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules
[defaultnavigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/variables/defaultNavigationRules/
[onpermissionrequest]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onpermissionrequest
[ondownload]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#ondownload
[iossettings]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/
[debugging]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/AndroidWebView/functions/setWebContentsDebuggingEnabled/
[onprocessgone]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onprocessgone
[injectedscript]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/InjectedScript/
