# Decisions

Why the package does what it does where the choice was not obvious, with what was considered and rejected. Newest last.

## One document scope per platform

Asks, evaluations, the bridge reply target, the ask cache, the file chooser, the open JS dialog (iOS), fullscreen video
(Android), the refresh spinner (iOS, on crash) and new-window child WebViews (Android) all belong to one Document, but
commit, crash and teardown each hand-listed what to reset, and the lists disagreed per platform and per trigger: neither
crash path cleared the ask cache, Android's crash left fullscreen video up, iOS's commit left a dialog up, iOS's spinner
outlived a crash, and `destroy()` left child WebViews to a timer. Decided 2026-10-21: each platform gets a
`DocumentScope` with `register((End) -> Unit)` and `end(reason)`, `End` being `committed`, `crashed` or `closing`.
Document-bound features register once; the view's callbacks make one call each; the scope imports no WebView, so JVM
and swiftc tests drive all three ends with fake registrants.

### What counts as an end

- `committed`: a main-frame navigation commits, a back-forward-cache restore included. A restore ends the page it
  replaces; the restored page starts a fresh scope, and only its page client is restore-aware. Not an end:
  same-document navigations, loads that never commit (download, 204, cancel, an iOS provisional failure), navigation
  start, a `source` change or `stopLoading` before the commit, sub-frame navigations, the view leaving the window, the
  app backgrounding. A failed load ends the Document on Android only, where an error page commits.
- `crashed`: the renderer died, reload or not. Everything `committed` does, plus crash-only cleanup. The bridge rejects
  posted calls with `navigated` at once rather than at the reload's commit or the 10 s timeout: a behaviour change.
- `closing`: `OnViewDestroys` on Android. `invalidate` on iOS, at unmount (see Corrections); `deinit` tears down the
  WebView if that never ran, but its registrants see no view.

### Considered and rejected

- Before WebView 146, Android has no commit callback of its own, so `onPageStarted` stays the commit signal. Chromium
  calls it at commit (for every app but old GMS), so a main-frame load that never commits leaves the Document as it was
  and fires no load events. Seen on WebView 133 (2026-10-23): 1 s into a navigation to a 3 s slow response, the state
  still reads `loading: false` with the old `url` (`urlTracking`'s "during slow load"). `onPageCommitVisible` is a
  true commit signal but fires after the body starts, so an early page post, or a small page's `ready`, would lose its
  reply proxy to the late reset.
- A protocol with three methods, or the scope calling each feature's existing reset methods in order: closures that
  take the reason keep the interface to two members. Registration order is dispatch order; nothing is promised between
  registrants.
- Navigation start as a fourth end: the file chooser's cancel at `onNavigationStarted` stays its own, outside the scope.

### Out of scope, deliberately

- Navigation-state fields (`url`, `pendingUrl`, `title`, `loading`, `progress`; iOS `failedUrl`, `programmaticUrl`,
  `htmlCommit`) stay per view: crash recovery reads them to choose what to reload. They are stale after an unrecovered
  crash; that is a navigation-state decision, not a scope one.
- Per-WebView-instance state (hooks, script handles and listeners, `crashTimes`, the cookie observer, Android's refresh
  layout) stays in `recover()`, `destroy()` and `tearDown()`, which call the scope first.
- Downloads outlive Documents by design and are not cancelled at teardown. `onPermissionRequestCanceled` leaving the
  core's own permission ask open is a separate fix: it must also stop the ask's `grant`/`deny` from reaching the
  cancelled request, since Chromium's `PermissionRequest` throws once its native side is gone.

### Corrections (2026-10-21)

- **The permission-cancel follow-up:** Chromium's `PermissionRequest` doesn't throw once its native side is gone.
  `AwPermissionRequest.grant()` and `deny()` throw only off the UI thread or on a second call; with the native side
  gone they are no-ops, and the core answers once, on the main thread. What an uncancelled ask still costs is a stale
  entry and the app's handler running (maybe an OS prompt) for a request nobody wants.
- **`closing` on iOS:** `invalidate` doesn't stop at a Fabric wrapper. `MinimalWebView` is the Fabric component view,
  and React Native calls `invalidate` on it at unmount (Expo views are never recycled); only the Swift-visible header
  doesn't declare it. So `closing` moved from `deinit` to an `@objc invalidate` that calls the inherited one
  (2026-10-22), and the registrants hold the view weakly instead of `unowned(unsafe)`.
- **Child WebViews:** this change didn't fix "`destroy()` left child WebViews to a timer". `View.post` on a detached view
  never runs, so a child was still left undestroyed at unmount. Fixed later: every Document end destroys the children
  directly, and the deferred work posts through a main-thread `Handler`.
- **`crashTimes`** is not per WebView instance. On iOS it is per view, spanning WebView instances (a source change
  clears it); on Android it is per process, since the app's WebViews share one renderer.

## New windows load in place

`target=_blank` and `window.open` ask the app for a second WebView: `onCreateWindow` on Android, `createWebViewWith`
on iOS. A real second view brings a popup model the package would own (presenting it, closing it on `window.close`,
its own rules, events and bridge, `window.opener` across the two), and almost every app only wants the link to open.
Decided 2026-10-22: there is never a second WebView. A new window goes through the navigation rules as
`newWindow: true`, and `allow` loads it in the current WebView, so the page has no `window.opener`.

### What follows

- Internal schemes (`about:`, `blob:`, `data:`, `javascript:`) and `file:` are blocked for a new window before the
  rules run, so no rule can allow one. The core loads the window's URL in the main frame itself, through the app-level
  API, which skips the engine's limits on what a page may navigate the top frame to: a `data:` page, or a `file:` URL
  read with the app's access.
- Android has to hand `onCreateWindow` a WebView to learn the URL: a throwaway child with no JS and no file access
  catches the first navigation, and is destroyed after it, at the Document's end, or when the window doesn't navigate
  within 5 s (`window.open('')`), which drops the window. iOS reads the URL from the navigation action and returns
  `nil`.
- An app that needs real popups (an OAuth window, `window.opener.postMessage`) takes `onCreateWindow` or
  `createWebViewWith` in a native hook and owns the second view; the core then decides nothing for it.

### Considered and rejected

- A popup model, `onOpenWindow` with a child `WebView` the app renders: a large feature (two views' lifecycles,
  crash recovery, rules and bridge per child, `window.close`) with no demand, and the native hook already covers it.

## Universal links stay in place

On iOS, `decisionHandler(.allow)` for a tapped link to another host lets WebKit hand the URL to an installed app that
claims it as a universal link, and the WebView never sees it again. Android's WebView never hands off App Links
itself. react-native-webview answers plain `.allow`, so its apps inherit the hand-off on iOS only, with no way to stop
it: the two platforms behave differently for the same rule. Decided 2026-10-22 (first shipped in 7eb9363): on iOS
`allow` answers WebKit's private `_WKNavigationActionPolicyAllowWithoutTryingAppLink`, `.allow.rawValue + 2`, as
Firefox for iOS does, so a tapped universal link loads in the WebView, as on Android. Hand-off is an explicit
per-host `external` rule, which opens the URL through the OS resolver on both platforms (`UIApplication.open`,
`Intent(ACTION_VIEW)`), and that is where the claiming app gets it.

### Risks

- Private API: App Store review could object to the value, though it is a raw enum number, not a selector or symbol.
- If WebKit renumbers or drops it, the fallback is plain `.allow` and the hand-off comes back. It is one constant,
  `allowInPlace` in `MinimalWebView+Navigation.swift`.

### Considered and rejected

- Hand-off by default (plain `.allow`): iOS and Android would split on the same rules, and no rule could keep a
  claimed host in place on iOS.
