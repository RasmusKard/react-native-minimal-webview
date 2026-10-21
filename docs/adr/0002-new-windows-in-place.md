---
status: accepted
---

# New windows load in place

`target=_blank` and `window.open` ask the app for a second WebView: `onCreateWindow` on Android, `createWebViewWith`
on iOS. A real second view brings a popup model the package would own (presenting it, closing it on `window.close`,
its own rules, events and bridge, `window.opener` across the two), and almost every app only wants the link to open.
Decided 2026-10-22: there is never a second WebView. A new window goes through the navigation rules as
`newWindow: true`, and `allow` loads it in the current WebView, so the page has no `window.opener`.

## What follows

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

## Considered and rejected

- A popup model, `onOpenWindow` with a child `WebView` the app renders: a large feature (two views' lifecycles,
  crash recovery, rules and bridge per child, `window.close`) with no demand, and the native hook already covers it.
