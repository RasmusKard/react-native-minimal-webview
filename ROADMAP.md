# Roadmap

Possible future work, not commitments.

## Core, if wanted

- **Android `scrollEnabled`.** iOS has `ios.scrollView.scrollEnabled`; Android has no setter for it. Injected CSS
  `overflow: hidden` covers it today.

## User space (a recipe or an optional extension)

- **Incognito (non-persistent storage) on Android.** iOS has `ios.configuration.websiteDataStore: 'nonPersistent'`.
- **iOS keyboard props** as an extension. The keyboard accessory one needs swizzling.

## Known limits, left as they are

- **Android navigation rules:** the reissued `ask` load loses the page's referrer policy and the gesture flag, POST
  skips the rules, and http(s) iframes aren't decided
  ([platform differences](docs/navigation-rules.md#platform-differences)).
- **iOS `onProcessGone.didCrash` is always true**, because WebKit doesn't report a reason.
- **Android System WebView older than 146 or 101** loses features
  ([Android System WebView versions](docs/props.md#android-system-webview-versions)).

## Project

- The on-device suites in CI.
- Native linters (SwiftLint, detekt).
- Release tooling and a changelog before outside use.
