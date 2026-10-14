# Roadmap

Possible future work, not commitments.

## Core, if wanted

- **POST loads** (`source.method` and `body`). Today's workaround is `source.html` with a self-submitting form.
- **Android `scrollEnabled`.** iOS has `ios.scrollView.scrollEnabled`; Android has no setter for it. Injected CSS
  `overflow: hidden` covers it today.

## User space (a recipe or an optional extension)

- **`onScroll`:** a page script plus `bridge.emit`.
- **Incognito (non-persistent storage):** on iOS an extension's `configure` sets `WKWebsiteDataStore.nonPersistent()`;
  Android needs its own approach.
- **`clearCache` / `clearHistory`:** a built-in extension, like `sharedCookies`.
- **iOS keyboard props** as an extension. The keyboard accessory one needs swizzling. (Back/forward swipe gestures
  are `ios.webView.allowsBackForwardNavigationGestures`.)

## Known limits, left as they are

- **Android `ask`:** the reissued load loses the referrer and the gesture flag, POST and the initial load skip the
  rules, and http(s) iframes aren't decided.
- **iOS `onProcessGone.didCrash` is always true**, because WebKit doesn't report a reason.
- **Android System WebView 133** (no `NAVIGATION_LISTENER`, tested on a Google APIs API 36 image): `pendingUrl` isn't
  reported, a main-frame SSL error isn't reported, `100vh` is 0 after crash recovery, and back doesn't leave fullscreen
  video. The `urlTracking`, `errors`, `crash` and `fullscreen` suites fail those checks there.
- **Android System WebView older than 101** (91 on the API 29 Google APIs image) has no `DOCUMENT_START_SCRIPT`: no bridge and no
  injected scripts.

## Project

- The on-device suites in CI.
- Native linters (SwiftLint, detekt).
- Release tooling and a changelog before outside use.
