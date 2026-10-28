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
(`npx install-expo-modules@latest`). On Android, the bridge and `injectedScripts` need
[Android System WebView 101+](#android-system-webview-versions), `evaluate` and `blob:` downloads 83+. On a current
Xcode, SDK 53 apps need React Native's `fmt` pod built as C++17 (a Podfile `post_install` hook). The build is ESM: Jest
consumers add `minimal-rn-webview` to `transformIgnorePatterns` (with jest-expo, to its `node_modules/(?!...)`
allowlist).

```tsx
import { WebView } from 'minimal-rn-webview';

export function Browser() {
  return <WebView source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

## Docs

- [Examples](docs/examples.md): one per public interface, from the navigation state to native hooks
- [API reference](docs/api/README.md), generated from the TSDoc. The native hook API is documented on
  `MinimalWebViewHooks` and `WebViewContext` in `ios/Hooks.swift` and `android/src/main/java/expo/modules/minimalwebview/Hooks.kt`
- [Migrating from react-native-webview](docs/migrating-from-react-native-webview.md): what differs, and recipes for what
  has no prop
- [Development](docs/development.md): the checks and the on-device suites

## Android System WebView versions

Android System WebView updates apart from the OS (through the Play Store; Huawei and Fire OS devices ship their own
builds), so what a device can do depends on its WebView, not its API level. The core checks each feature at run time,
and an older WebView loses the feature with a warning; nothing crashes. Below WebView 101: the bridge and
`injectedScripts`. Below 83: `evaluate`, and so `blob:` downloads. Below 146: `pendingUrl`, the load events of a load
that never commits, an SSL error on a back/forward load, and the back-forward cache. Each one's TSDoc says so.
`preconnect` and favicon downloads need features newer still, and an `android` setting this WebView lacks is skipped
with a warning.
