---
status: accepted
---

# One document scope per platform

Asks, evaluations, the bridge reply target, the ask cache, the file chooser, the open JS dialog (iOS), fullscreen video
(Android), the refresh spinner (iOS, on crash) and new-window child WebViews (Android) all belong to one Document, but
commit, crash and teardown each hand-listed what to reset, and the lists disagreed per platform and per trigger: neither
crash path cleared the ask cache, Android's crash left fullscreen video up, iOS's commit left a dialog up, iOS's spinner
outlived a crash, and `destroy()` left child WebViews to a timer. Decided 2026-10-21: each platform gets a
`DocumentScope` with `register((End) -> Unit)` and `end(reason)`, `End` being `committed`, `crashed` or `closing`.
Document-bound features register once; the view's callbacks make one call each; the scope imports no WebView, so JVM
and swiftc tests drive all three ends with fake registrants.

## What counts as an end

- `committed`: a main-frame navigation commits, a back-forward-cache restore included. A restore ends the page it
  replaces; the restored page starts a fresh scope, and only its page client is restore-aware. Not an end:
  same-document navigations, loads that never commit (download, 204, cancel, an iOS provisional failure), navigation
  start, a `source` change or `stopLoading` before the commit, sub-frame navigations, the view leaving the window, the
  app backgrounding. A failed load ends the Document on Android only, where an error page commits.
- `crashed`: the renderer died, reload or not. Everything `committed` does, plus crash-only cleanup. The bridge rejects
  posted calls with `navigated` at once rather than at the reload's commit or the 10 s timeout: a behaviour change.
- `closing`: `OnViewDestroys` on Android. `deinit` on iOS, because Expo 58's Swift view API has no destroy hook and
  React Native's `invalidate` stops at Expo's Fabric wrapper. Risk: anything retaining the view delays `closing` past
  unmount.

## Considered and rejected

- Before WebView 146, Android has no commit callback, so `onPageStarted` (load start) stays the commit signal, early by
  the provisional window: a main-frame load that never commits ends the Document spuriously. `onPageCommitVisible` is a
  true commit signal but fires after the body starts, so an early page post, or a small page's `ready`, would lose its
  reply proxy to the late reset.
- A protocol with three methods, or the scope calling each feature's existing reset methods in order: closures that
  take the reason keep the interface to two members. Registration order is dispatch order; nothing is promised between
  registrants.
- Navigation start as a fourth end: the file chooser's cancel at `onNavigationStarted` stays its own, outside the scope.

## Out of scope, deliberately

- Navigation-state fields (`url`, `pendingUrl`, `title`, `loading`, `progress`; iOS `failedUrl`, `programmaticUrl`,
  `htmlCommit`) stay per view: crash recovery reads them to choose what to reload. They are stale after an unrecovered
  crash; that is a navigation-state decision, not a scope one.
- Per-WebView-instance state (hooks, script handles and listeners, `crashTimes`, the cookie observer, Android's refresh
  layout) stays in `recover()`, `destroy()` and `tearDown()`, which call the scope first.
- Downloads outlive Documents by design and are not cancelled at teardown. `onPermissionRequestCanceled` leaving the
  core's own permission ask open is a separate one-line fix.
