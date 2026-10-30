# react-native-minimal-webview

A WebView for React Native that decides navigations in native code, talks to the page over a typed promise bridge, and
takes every iOS and Android WebView setting by its platform name. Built with the Expo Modules API, for the new
architecture.

[API reference](https://rasmuskard.github.io/react-native-minimal-webview/modules.html) ·
[Examples](guides/examples.md) ·
[Migrating from react-native-webview](guides/migrating-from-react-native-webview.md) ·
[Extensions](https://rasmuskard.github.io/react-native-minimal-webview/extensions/) ·
[MIT license](https://github.com/RasmusKard/react-native-minimal-webview/blob/main/LICENSE)

![The app sends rules and settings to the native WebView core and gets state and events back; the core answers the page's navigations; the bridge links the app and allowed origins](guides/how-it-works.svg)

## What it changes from react-native-webview

react-native-webview asks JS about each navigation and wraps platform settings one prop at a time. This package
matches navigations against rules in native code, and passes any setting through by name.

| | react-native-webview | react-native-minimal-webview |
|---|---|---|
| Deciding a navigation | `onShouldStartLoadWithRequest`, a JS round trip each time. Android blocks the UI thread, then lets the navigation through on a timeout | `navigationRules`, matched natively. JS hears the outcome in `onNavigation` |
| Talking to the page | `postMessage` strings, from every page | A typed promise bridge, only with `allowedOrigins` |
| Platform settings | One prop per setting it wraps | Any setting, typed: `ios={{ scrollView: { bounces: false } }}` |
| Navigation state | You keep it from `onNavigationStateChange` | `useWebViewState(ref)`: URL, title, progress, history |
| File and camera requests | Android asks for the camera permission itself | Your app answers them, with libraries such as expo-image-picker |
| Anything else | A patch or a fork | A native hook in your own Swift or Kotlin module |

The [migration guide](guides/migrating-from-react-native-webview.md) maps every react-native-webview prop.

## When to use something else

- Old architecture, Windows, macOS or web: react-native-webview supports them, this package doesn't.
- Expo Go: the package has native code, so it needs a development build.

## Install

```sh
npx expo install react-native-minimal-webview
```

Then rebuild the app (`npx expo run:ios`, `npx expo run:android`).

A bare React Native app adds Expo modules first, then installs with its package manager:

```sh
npx install-expo-modules@latest
npm install react-native-minimal-webview   # or: yarn add, pnpm add
```

### Requirements

| | Minimum |
|---|---|
| iOS | 17.0 |
| Android | API 29: `minSdkVersion 29`, for example with `expo-build-properties` |
| Android System WebView | Some features need a newer one ([below](#android-system-webview-versions)) |
| Expo SDK | 53 (React Native 0.79, React 19) |
| Architecture | New architecture only |

Expo SDK 53 on a current Xcode: build React Native's `fmt` pod as C++17, with a Podfile `post_install` hook that sets
its `CLANG_CXX_LANGUAGE_STANDARD` to `c++17`.

Jest: the build is ESM, so add `react-native-minimal-webview` to `transformIgnorePatterns` (with jest-expo, to its
`node_modules/(?!...)` allowlist).

## Usage

```tsx
import { WebView } from 'react-native-minimal-webview';

export function Browser() {
  return <WebView source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

Then pick what you need:

| To | See |
|---|---|
| Show the URL, progress or a back button | [Navigation state](guides/examples.md#navigation-state) |
| Keep the WebView on your sites, open the rest externally | [Navigation rules](guides/examples.md#navigation-rules) |
| Call the page from the app, and the app from the page | [The bridge](guides/examples.md#the-bridge) |
| Change a WebView setting | [Platform settings](guides/examples.md#platform-settings) |
| Share cookies with native requests | [Cookies](guides/examples.md#cookies) |
| Run a script on every page | [Scripts](guides/examples.md#scripts) |
| Load bundled HTML | [Local files](guides/examples.md#local-files) |
| Answer file pickers, permissions and downloads | [Page requests](guides/examples.md#page-requests) |
| Use the native `WKWebView` or `WebView` | [Native hooks](guides/examples.md#native-hooks), and `MinimalWebViewHooks` in `ios/Hooks.swift` and `android/src/main/java/expo/modules/minimalwebview/Hooks.kt` |
| Bring back `basicAuthCredential`, `onScroll` and other react-native-webview props | [@react-native-minimal-webview/extensions](https://rasmuskard.github.io/react-native-minimal-webview/extensions/) |

## Android System WebView versions

On Android, what a device can do depends on its WebView, not its API level. Android System WebView updates apart from
the OS, through the Play Store; Huawei and Fire OS devices ship their own builds.

The core checks each feature at run time. On an older WebView, the feature is off and nothing crashes. Losing the
bridge or `injectedScripts` logs a warning. Each feature's TSDoc names the WebView it needs.

## Contributing

[CONTRIBUTING.md](https://github.com/RasmusKard/react-native-minimal-webview/blob/main/.github/CONTRIBUTING.md) has the setup, the checks and the on-device suites.
