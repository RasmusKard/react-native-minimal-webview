# Decisions

Why the package does what it does where the choice was not obvious, with what was considered and rejected. Newest last.

## One document scope per platform

What belongs to one Document (asks, evaluations, the bridge reply target, the file chooser, dialogs and the rest) was
reset by lists that commit, crash and teardown each wrote by hand, and the lists disagreed per platform and per
trigger. Now each platform has a `DocumentScope`: Document-bound features `register` once, and the view calls
`end(reason)` with `committed`, `crashed` or `closing`. A failed load ends the Document on Android only, where an error
page commits. The scope imports no WebView, so JVM and swiftc tests drive all three ends. Navigation state stays
outside it (crash recovery reads it to choose what to reload), and so do downloads, which outlive Documents.

Rejected: a protocol with three methods, or the scope calling each feature's reset methods (closures that take the
reason keep the interface to two members); navigation start as a fourth end; `onPageCommitVisible` as Android's commit
signal before WebView 146 (it fires after the body starts, so an early page post would lose its reply proxy).

## New windows load in place

`target=_blank` and `window.open` ask the app for a second WebView. A real second view brings a popup model the
package would own (presenting it, closing it on `window.close`, its own rules, events and bridge, `window.opener`
across the two), and almost every app only wants the link to open. So there is never a second WebView: a new window
goes through the navigation rules as `newWindow: true`, and `allow` loads it in place, without `window.opener`. The
core loads it through the app-level API, which skips the engine's limits on top-frame navigation, so internal schemes
and `file:` are blocked for a new window before the rules run. An app that needs real popups (an OAuth window,
`window.opener.postMessage`) takes `onCreateWindow` or `createWebViewWith` in a native hook and owns the second view.

Rejected: a popup model (`onOpenWindow` with a child `WebView` the app renders): two views' lifecycles, crash recovery,
and rules and a bridge per child, with no demand, and the native hook already covers it.

## Universal links stay in place

On iOS, `decisionHandler(.allow)` for a tapped link lets WebKit hand a universal link to the app that claims it, and
the WebView never sees it again; Android's WebView never hands off App Links itself. So on iOS `allow` answers WebKit's
private `_WKNavigationActionPolicyAllowWithoutTryingAppLink` (`.allow.rawValue + 2`, as Firefox for iOS does), and a
tapped universal link loads in place, as on Android. Hand-off is an explicit `external` rule, which opens the URL
through the OS on both platforms (`UIApplication.open`, `Intent(ACTION_VIEW)`). The private value could draw an App
Store objection, and if WebKit drops it, plain `.allow` brings the hand-off back (one constant, `allowInPlace` in
`MinimalWebView+Navigation.swift`).

Rejected: hand-off by default (plain `.allow`, as react-native-webview does): iOS and Android would split on the same
rules, and no rule could keep a claimed host in place on iOS.

## Android downloads fetch with HttpURLConnection

Android's WebView hands a download over as a URL, so the core fetches it again with the WebView's cookies. That used
React Native's OkHttp and its `ForwardingCookieHandler`, the package's only use of `react-android`. Now it is
`HttpURLConnection` with `CookieManager`, redirects followed by hand (`Downloads.kt`): each hop sends and stores its
own URL's cookies, at most 20 redirects (OkHttp's limit), and a hop goes only to https or from http to http, which also
refuses the http to https to http chain OkHttp's check let through. The cookie store is passed in, so a JVM test runs
the loop against a local server, and the package builds without `react-android`.

Rejected: keeping OkHttp through `react-android` (no code, but tied to a React Native networking class); OkHttp with
its own `CookieJar` (about as long, and keeps the dependency).

## The view is the aggregate root

`MinimalWebView` holds, on each platform, what has one owner by nature: the Expo surface (Expo binds props, events and
functions to the view instance), the platform WebView's life, crash recovery, the Document scope, the navigation
state, the hook plumbing and, on iOS, the one core `WKNavigationDelegate` behind `DelegateProxy`. A feature with state
of its own owns it in its own class and takes the view only for props, events and the current WebView. Swift's
`+Feature` files are one type split by file, since an extension can't hold stored properties. So the two view classes
are the one place the size checks don't apply (detekt's `TooManyFunctions`, SwiftLint's `type_body_length` and
`file_length`, disabled there with this section as the reason); every other class and file keeps the global thresholds.

Rejected: the core's page requests written against the hook seam (`WebViewContext` instead of the view): 4 of the 6
additions they would need are core-only and would become a hidden half of the context.

## Shared cookies, pull-to-refresh and download saving stay in Core

These three were candidates to leave Core. They stay: Core is all of the package's native code, so an extension inside
the package removes no line (the prop stays, and the seams and glue add about 6, 38 and 38 lines), and a recipe in the
app costs each app that wants the feature an Expo module of its own (about 90, 195 and 295 lines) and a native rebuild,
more than the feature costs the package. A hook seam lands only for a named use, an extension that needs it.

Rejected: each as an extension inside the package, no smaller and each with its own break (`sharedCookies` becomes a
taken hook key, pull-to-refresh takes the WebView out of the `SwipeRefreshLayout` it always sits in, download saving
renames the pinned `core.download` event); each as a recipe in the app (the module above, and shared cookies would
still miss the first load, which nothing outside the core can hold).
