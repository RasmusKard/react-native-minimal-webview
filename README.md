# minimal-rn-webview

A small, extensible WebView for React Native, built with the Expo Modules API (Swift and Kotlin), for the new
architecture only.

- **Native decides, JS is told:** navigation rules run natively, with no JS round trip per navigation.
- **One committed URL, owned by native:** `useWebViewState(ref)` gives the page on screen, a pending load, the title,
  progress and history.
- **A promise bridge** between React Native and the page, restricted to the origins you allow.
- **Page requests just work:** file chooser, fullscreen video, permissions and downloads each have a default, and a
  prop takes one over.
- **Every platform setting by name,** without a change to this package: `ios={{ scrollView: { bounces: false } }}`,
  `android={{ settings: { textZoom: 120 } }}`.
- **The app owns device APIs:** no OS permission prompts or pickers of its own, no config plugin, and no dependency on
  expo-camera or similar packages.

**Requirements:** iOS 16.4, Android API 29+ (`minSdkVersion 29`, for example with `expo-build-properties`), and Expo
SDK 53+ (React Native 0.79+, React 19) with the new architecture. A bare React Native app works too, once it has the
`expo` package through `npx install-expo-modules@latest`. On Android, the bridge, `injectedScripts` and `evaluate`
need [Android System WebView 101+](docs/bridge.md#android-system-webview). The floor is checked by a build and a
smoke run on SDK 53 and 55; the on-device suites run on SDK 58. SDK 53 apps on a current Xcode need React Native's
`fmt` pod built as C++17 (a Podfile `post_install` hook), which is React Native's issue, not this package's.

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
- [Props and ref methods](docs/props.md): every prop, `evaluate`, `WebView.warmUp` and `preconnect`, loading and error screens
- [Platform settings](docs/platform-settings.md): any WebKit or Android setting by name, and `get` and `call`
- [Page requests](docs/page-requests.md): file chooser, fullscreen video, permissions and downloads, with recipes
- [Native hooks](docs/native-hooks.md): your own Swift and Kotlin, with the real `WKWebView` or `WebView`
- [Security defaults](docs/security.md)
- [Development](docs/development.md): unit tests and the on-device suites
- [Roadmap](ROADMAP.md)
