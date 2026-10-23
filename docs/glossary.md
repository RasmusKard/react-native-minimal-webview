# Glossary

A React Native WebView whose native side owns the navigation state and the lifetime of everything a page asks for.

**Document**:
The main-frame page a WebView shows now: it begins when a navigation commits, a back-forward-cache restore included,
and ends at the next commit (on Android a failed load commits an error page; on iOS nothing commits and the Document
lives on), a renderer crash, or the view closing. Asks, evaluations, the bridge reply target, the ask cache, the file
chooser, the open JS dialog (iOS), fullscreen video (Android), the refresh spinner (iOS, on crash) and new-window child
WebViews (Android) belong to one Document and end with it ([One document scope per platform](decisions.md#one-document-scope-per-platform)).
_Avoid_: page, when its lifetime matters

**Core**:
This package's own native code: it owns the WebView's delegate and client slots, the navigation state, the navigation
rules, the bridge transport, the page requests and crash recovery. `core` is the one hook key no hook can register.
_Avoid_: library, when the native side is meant

**Native hook**:
Swift or Kotlin in the app's own Expo module, registered under a key with `MinimalWebViewHooks.register`, that gets
the real `WKWebView` or `WebView` of every WebView created with a `hookOptions` value for its key. It adds delegates
and clients to the core's lists (one that takes a decision callback takes it from the core) and talks to JS with
`emit`, `ask` and `handle`
([Native hooks](native-hooks.md)). An extension is a package that ships hooks.
_Avoid_: plugin

**Ask**:
A question native puts to JS while it holds a platform callback open: an `ask` navigation rule
(`onNavigationRequest`), `onFileRequest`, `onPermissionRequest`, and a hook's `context.ask` (`onHookEvent`). Its
payload type is a `…Request`, and its handler gets an `AbortSignal` that aborts when native stops waiting. An ask
belongs to its Document: one still open when the Document ends is settled without JS (a navigation is blocked, a
file or permission request cancelled, a hook ask answered null).
_Avoid_: prompt, callback

**Page request**:
Something a page asks for that only the app can give: a file, fullscreen video, a permission, a download, a JS dialog,
HTTP auth. Each works without a prop; a prop either answers it (an Ask) or is told afterwards (a `…Event`), and JS
dialogs and HTTP auth only a native hook takes over ([Page requests](page-requests.md)).

**Settings root**:
An object whose keys the `ios` and `android` props set by their platform names, and `get` and `call` read and call:
iOS `configuration`, `preferences`, `webpagePreferences`, `webView` and `scrollView`, Android `settings` and `webView`;
for `get` and `call` also iOS `websiteDataStore` and `httpCookieStore`, Android `cookieManager` and `webStorage`. Every
root is live except iOS `configuration`, which WebKit reads once, so a change recreates the WebView.
_Avoid_: options (that is `hookOptions`)

**Crash recovery**:
What the core does when the renderer dies: it ends the Document, reloads the page (on Android in a new WebView, with
the history restored) and reports `onProcessGone`. The crash guard stops the reloads after more than 3 crashes in 60 s,
counted for the whole app on Android, whose WebViews share one renderer, until the next `source` change or `reload()`.
A POST `source` is never sent again unasked.
