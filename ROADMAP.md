# Roadmap

Possible future work, not commitments.

## Core, if wanted

- **Android `scrollEnabled`.** iOS has `ios.scrollView.scrollEnabled`; Android has no setter for it. Injected CSS
  `overflow: hidden` covers it today.

## User space (a recipe or an optional extension)

- **Incognito (non-persistent storage) on Android.** iOS has `ios.configuration.websiteDataStore: 'nonPersistent'`.
- **`clearCache` / `clearHistory`:** a built-in extension, like `sharedCookies`.
- **iOS keyboard props** as an extension. The keyboard accessory one needs swizzling.

## Known limits, left as they are

- **Android navigation rules:** the reissued `ask` load loses the page's referrer policy and the gesture flag, POST
  skips the rules, and http(s) iframes aren't decided
  ([platform differences](docs/navigation-rules.md#platform-differences)).
- **iOS `onProcessGone.didCrash` is always true**, because WebKit doesn't report a reason.
- **Android WebView older than 146** (no `NAVIGATION_LISTENER`; tested with 133 on a Google APIs API 36 image):
  `pendingUrl` isn't reported, an SSL error on a back/forward load isn't reported, `100vh` is 0 after crash recovery,
  back doesn't leave fullscreen video, and an open file chooser is cancelled only when the next page commits. The
  `urlTracking`, `crash` and `fullscreen` suites fail those checks there, and `settings` fails its `WebSettingsCompat`
  check (the payment request setting isn't supported).
- **Android System WebView older than 101** (91 on the API 29 Google APIs image) has no `DOCUMENT_START_SCRIPT`: no bridge and no
  injected scripts.

## Project

- The on-device suites in CI.
- Native linters (SwiftLint, detekt).
- Release tooling and a changelog before outside use.
