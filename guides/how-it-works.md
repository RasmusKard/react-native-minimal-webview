# How it works

What runs where, and the terms the rest of the docs use: the core, frames, origins, rules and the bridge.

![The app sends rules and settings to the native WebView core and gets state and events back; the core answers the page's navigations; the bridge links the app and allowed origins](how-it-works.svg)

## The parts

| Part          | What it is                                                             | What it does                                                                                                        |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The page      | Your site, in `WKWebView` on iOS and Android System WebView on Android | Runs in its own process, the renderer, apart from the app                                                           |
| The core      | This package's Swift and Kotlin around that WebView                    | Decides navigations, keeps the navigation state, answers the page's requests, carries the bridge                    |
| Your app's JS | The `<WebView>` props, its ref and your callbacks                      | Gives the core its rules and settings, and gets its events                                                          |
| A native hook | Your own Swift or Kotlin, optional                                     | Gets the native WebView ([native hooks](native-hooks.md)). Its JS side goes in the [`extensions`][extensions] prop. |

The core decides from the props without waiting for JS, so a busy JS thread doesn't hold the page up. It asks JS only
where a prop says so: an `ask` rule ([`onNavigationRequest`][onnavigationrequest]), an `external` navigation when you
pass [`onOpenExternal`][onopenexternal], and the page's requests for files and permissions
([page requests](examples.md#page-requests)).

The **bridge** carries calls and events between your app's JS and the page's JS. The page uses it through
`window.nativeBridge`. The app makes it with [`createBridge`][createbridge] and passes it as the [`bridge`][bridge] prop.

## Frames and origins

The **main frame** is the page's top-level document, the one whose URL the navigation state shows.

`allowedOrigins`, a script's `origins` and the permission check compare a frame's origin as `location.origin` writes it, such as `https://example.com`. A page from an `html`
source without `baseUrl`, a `data:` URL or a sandboxed iframe has an opaque origin, which only `'*'` matches.

The core gives the main frame more than it gives iframes, and trusts only the origins you name:

| Feature                             | Main frame                       | Iframes                                                                 |
| ----------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| [Navigation state][navigationstate] | Its `url` is this frame's        | Never change its `url`                                                  |
| [Navigation rules][navigationrule]  | Decided                          | Decided on iOS; on Android only for non-http(s) URLs                    |
| [The bridge][allowedorigins]        | On the bridge's `allowedOrigins` | Never                                                                   |
| [Injected scripts][injectedscript]  | On the script's `origins`        | Only with `allFrames`, each frame matched by its own origin             |
| [`evaluate`][evaluate]              | Runs here                        | Never                                                                   |
| [Camera and microphone][permission] | Asks your `onPermissionRequest`  | Denied without asking, except on Android one on the main frame's origin |

## How a navigation is decided

1. These load in place without the rules: the `source` load, [`load(url)`][load], reloads, back and forward, form
   POSTs, and `about:`, `data:` and `javascript:` URLs unless they open a [new window][newwindow]. A redirect of the
   `source` load or a `load` goes to the rules. [`navigationRules`][navigationrules] lists each case per platform.
2. Any other navigation goes down [`navigationRules`][navigationrules], and the first rule that matches decides. Its
   action is `allow`, `block`, `external` or `ask`.
3. A navigation no rule matches is blocked.

Without the prop, the rules are [`defaultNavigationRules`][defaultnavigationrules]. [`onNavigation`][onnavigation]
reports every decision with the index of the rule that made it.

## Which props recreate the WebView

Only two props recreate the native WebView when they change, which reloads the page. [`bridge`][bridge] is compared by
identity ([keep it stable](troubleshooting.md#the-page-reloads-or-the-navigation-state-starts-over)), and
[`ios.configuration`][configuration] by value. Every other prop, callbacks included, can be written inline.

[onopenexternal]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onopenexternal
[onnavigationrequest]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onnavigationrequest
[navigationstate]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/
[navigationrule]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationRule/#mainframe
[allowedorigins]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/BridgeOptions/#allowedorigins
[injectedscript]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/InjectedScript/
[evaluate]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#evaluate
[permission]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/PermissionRequest/
[navigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules
[defaultnavigationrules]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/variables/defaultNavigationRules/
[onnavigation]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onnavigation
[load]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#load
[bridge]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#bridge
[configuration]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/#configuration
[extensions]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#extensions
[createbridge]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/functions/createBridge/
[newwindow]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationRule/#newwindow
