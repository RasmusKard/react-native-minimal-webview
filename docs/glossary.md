# Glossary

A React Native WebView whose native side owns the navigation state and the lifetime of everything a page asks for.

**Document**:
The main-frame page on screen, from its navigation's commit (a back-forward-cache restore included) to the next commit,
a renderer crash or the view closing. What the page asked for ends with it ([decision](decisions.md#one-document-scope-per-platform)).
_Avoid_: page, when its lifetime matters

**Core**:
This package's own native code, which owns the WebView's delegate and client slots. `core` is the one hook key no hook
can register.
_Avoid_: library, when the native side is meant

**Native hook**:
Swift or Kotlin in the app's own Expo module that gets the real `WKWebView` or `WebView` of each WebView created with a
`hookOptions` value for its key ([Native hooks](native-hooks.md)). An extension is a package that ships hooks.
_Avoid_: plugin

**Ask**:
A question native puts to JS while it holds a platform callback open: `onNavigationRequest`, `onFileRequest`,
`onPermissionRequest`, a hook's `context.ask`. Its handler's `AbortSignal` aborts when native stops waiting, at the
latest when the Document ends; the ask is then settled without JS. An Ask's payload type is a `…Request` and a
notification's an `…Event`, except a hook's (a `HookEvent` for both) and `onDownload`'s (`Download`, `DownloadFailure`).
_Avoid_: prompt, callback

**Page request**:
Something a page asks for that only the app can give: a file, fullscreen video, a permission, a download, a JS dialog,
HTTP auth. Each works without a prop; a prop answers it (an Ask) or is told afterwards ([Page requests](page-requests.md)).

**Settings root**:
An object whose properties `ios` and `android` set by their platform names, and `get` and `call` reach, such as iOS
`scrollView` or Android `settings`. Every root is live except iOS `configuration`, which WebKit reads once.
_Avoid_: options (that is `hookOptions`)

**Crash recovery**:
What the core does when the renderer dies: it ends the Document, reloads the page (on Android in a new WebView) and
reports `onProcessGone`. The crash guard stops the reloads after more than 3 crashes in 60 s.
