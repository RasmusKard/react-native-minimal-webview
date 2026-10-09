# Roadmap

Possible future work, not commitments.

## Core, if wanted

- **Incognito (non-persistent storage).** It has to be core: iOS needs `WKWebsiteDataStore.nonPersistent()` when
  the WKWebView is created.
- **POST loads** (`source.method` and `body`). Today's workaround is `source.html` with a self-submitting form.
- **Android `scrollEnabled`.** Implement it, or document it as iOS-only. Injected CSS `overflow: hidden` covers it
  today.
- **A fallback for Android System WebView older than 146**, through `addDocumentStartJavaScript`. It would cover the
  bridge and `when: 'start'` scripts, but not `'end'` scripts without breaking globals, and it adds a second code path.

## User space (a recipe or an optional extension)

- **`onScroll`:** a page script plus `bridge.emit`.
- **`clearCache` / `clearHistory`:** a built-in extension, like `sharedCookies`.
- **iOS back/forward swipe gestures and the keyboard props** as an extension. The keyboard accessory one needs
  swizzling.

## Known limits, left as they are

- **Android `ask`:** the reissued load loses the referrer and the gesture flag, POST and the initial load skip the
  rules, and http(s) iframes aren't decided.
- **iOS `onProcessGone.didCrash` is always true**, because WebKit doesn't report a reason.

## Project

- The on-device suites in CI.
- Native linters (SwiftLint, detekt).
- Release tooling and a changelog before outside use.
