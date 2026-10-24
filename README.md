# minimal-rn-webview

A small, extensible WebView for React Native, built with the Expo Modules API (Swift and Kotlin), for the new
architecture only.

- **Native decides, JS is told:** navigation rules run natively, with no JS round trip per navigation.
- **Native owns the navigation state:** `useWebViewState(ref)` gives the committed URL, a pending load, the title,
  progress and history.
- **A promise bridge** between React Native and the page, for the origins you allow.
- **Page requests work without a prop:** a prop answers the file chooser and permissions, or hears about fullscreen
  video and downloads; JS dialogs and HTTP auth go to a native hook.
- **Every platform setting by name:** `ios={{ scrollView: { bounces: false } }}`, `android={{ settings: { textZoom: 120 } }}`.
- **The app owns device APIs:** no OS permission prompts, pickers or config plugin of its own, and no dependency on
  expo-camera or similar packages.

**Requirements:** iOS 16.4+, Android API 29+ (`minSdkVersion 29`, for example with `expo-build-properties`), Expo SDK
53+ (React Native 0.79+, React 19), the new architecture. A bare React Native app needs the `expo` package
(`npx install-expo-modules@latest`). On Android, the bridge, `injectedScripts` and `evaluate` need
[Android System WebView 101+](#android-system-webview-versions). On a current Xcode, SDK 53 apps need React Native's
`fmt` pod built as C++17 (a Podfile `post_install` hook). The build is ESM: Jest consumers add `minimal-rn-webview` to
`transformIgnorePatterns` (with jest-expo, to its `node_modules/(?!...)` allowlist).

```tsx
import { WebView } from 'minimal-rn-webview';

export function Browser() {
  return <WebView source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

## Docs

- [Navigation state](docs/navigation-state.md): `useWebViewState`, and `createWebViewRef` for code outside React
- [Navigation rules](docs/navigation-rules.md): which URLs load in place, open externally or are blocked
- [The bridge](docs/bridge.md): calls and events between React Native and the page
- [Platform settings](docs/platform-settings.md): any WebKit or Android setting by name, and `get` and `call`
- [Page requests](docs/page-requests.md): file chooser, fullscreen video, permissions, downloads and JS dialogs, with recipes
- [Native hooks](docs/native-hooks.md): your own Swift and Kotlin, with the real `WKWebView` or `WebView`
- [Security defaults](docs/security.md)
- [Migrating from react-native-webview](docs/migrating-from-react-native-webview.md): the prop map, the defaults that
  differ, and recipes for what has no prop
- [Development](docs/development.md): unit tests and the on-device suites
- [Glossary](docs/glossary.md): the words the docs and the code use
- [Decisions](docs/decisions.md): why things are the way they are, and what was rejected

The props, ref methods and types are documented in their TSDoc.

## Android System WebView versions

Android System WebView updates apart from the OS (through the Play Store; Huawei and Fire OS devices ship their own
builds), so what a device can do depends on its WebView, not its API level. The core checks each WebView feature at
run time: an older WebView loses the features below, and nothing crashes. WebView 146 and newer has all of them.

| WebView | Feature | Below it |
|---|---|---|
| 101 | `WEB_MESSAGE_LISTENER`, `DOCUMENT_START_SCRIPT` | Bridge calls reject with `unavailable`, `injectedScripts` don't run (each warns once per process), and `evaluate` rejects with `unavailable`, so `blob:` downloads fail. API 29+ devices with WebView updates on have it; the API 29 Google APIs emulator image ships 91 |
| 146 | `NAVIGATION_LISTENER` | `pendingUrl` stays `null` (`url` still follows commits and SPA navigation). A load that never commits fires neither `onLoadStart` nor `onLoadEnd`. An SSL error on a back/forward load isn't reported. The back-forward cache stays off (WebView 133 reports no page finish for a restored page). Seen on WebView 133: an open file chooser is cancelled only when the next page commits, and the `paymentRequestEnabled` setting isn't supported |

Other features are checked one by one: `preconnect` does nothing without `Profile.enqueuePreconnect` or `preconnect`,
favicon downloads stay on without `downloadFaviconsEnabled`, and an `android` setting this WebView lacks is skipped with
a warning.
