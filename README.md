# react-native-minimal-webview

A React Native WebView that hands you the iOS and Android WebView APIs, instead of wrapping each one in a prop.

It runs on iOS and Android as an Expo module.

[Get started](guides/getting-started.md) ·
[Install](#install) ·
[npm](https://www.npmjs.com/package/react-native-minimal-webview) ·
[API reference](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/) ·
[How it works](guides/how-it-works.md) ·
[Examples](guides/examples.md) ·
[Use a platform API](guides/platform-apis.md) ·
[Native hooks](guides/native-hooks.md) ·
[Migrating from react-native-webview](guides/migrating-from-react-native-webview.md) ·
[Troubleshooting](guides/troubleshooting.md) ·
[Extensions](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/) ·
[Changelog](https://github.com/RasmusKard/react-native-minimal-webview/blob/main/CHANGELOG.md) ·
[MIT license](https://github.com/RasmusKard/react-native-minimal-webview/blob/main/LICENSE)

## Why it exists

react-native-webview wraps each platform API in a prop of its own. When one isn't wrapped, you wait for an upstream
PR, or patch or fork the package, even if the change is one platform call.

This package passes the platform APIs through instead:

- `ios` and `android` props: any setting, by its platform name.
- The ref's `get` and `call`: properties and methods, by name.
- [Native hooks](guides/native-hooks.md): the `WKWebView` or `WebView` itself, in your own Swift or Kotlin
  module.

```tsx
import { useRef } from 'react';
import { Button, Platform } from 'react-native';
import { WebView, type WebViewRef } from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const pageDown = () => {
    // Android's WebView.pageDown(boolean): a method string names one platform's method
    if (Platform.OS === 'android') ref.current?.call('webView.pageDown', [true]);
  };
  return (
    <>
      <Button title="Page down" onPress={pageDown} />
      <WebView
        ref={ref}
        source={{ uri: 'https://example.com' }}
        style={{ flex: 1 }}
        ios={{ scrollView: { bounces: false } }}
        android={{ settings: { textZoom: 120 } }}
      />
    </>
  );
}
```

A setting a newer SDK adds goes under its root's `other` key, and `call` takes any public method, so neither waits for a
release of this package: see
[`ios`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#ios),
[`android`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#android) and
[`call`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#call).

## What the core adds

[How it works](guides/how-it-works.md) explains the parts. The core adds only what the platform APIs lack:

- [`navigationRules`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules): navigations decided
  natively, with a JS round trip only where a prop asks for one.
- A typed promise bridge ([`createBridge`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/functions/createBridge/)): `window.nativeBridge` in
  the page, open only to the bridge's [`allowedOrigins`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/BridgeOptions/#allowedorigins).
- [`useWebViewState(ref)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/functions/useWebViewState/): the navigation state, kept natively.
- [`onPermissionRequest`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onpermissionrequest): your app answers the
  page's permission requests (camera, microphone, location).

The [migration guide](guides/migrating-from-react-native-webview.md) covers each react-native-webview prop that works differently here.

## When to use something else

- Old architecture, Windows or macOS: react-native-webview supports them, this package doesn't. Neither runs on web.
- Expo Go: the package has native code, so it needs a
  [development build](https://docs.expo.dev/develop/development-builds/introduction/).

## Install

[Get started](guides/getting-started.md) walks you through a new Expo app with a WebView on screen.

In an Expo app, install the package and expo-build-properties:

```sh
npx expo install react-native-minimal-webview expo-build-properties
```

Set the iOS and Android [minimums](#requirements) in `app.json`, before you rebuild: below iOS 17.0, the build leaves
the package's native module out, and `WebView` throws as it renders.

```json
{
  "expo": {
    "plugins": [
      [
        "expo-build-properties",
        { "ios": { "deploymentTarget": "17.0" }, "android": { "minSdkVersion": 29 } }
      ]
    ]
  }
}
```

Then rebuild the app (`npx expo run:ios`, `npx expo run:android`).

A bare React Native app adds Expo modules first, then installs with its package manager. It sets the minimums in
`ios/Podfile` (`platform :ios, '17.0'`) and `android/build.gradle` (`minSdkVersion = 29`) before `pod-install`:

```sh
npx install-expo-modules@latest
npm install react-native-minimal-webview   # or: yarn add, pnpm add
npx pod-install
```

### Requirements

| Platform     | Minimum                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| iOS          | 17.0                                                                       |
| Android      | API 29                                                                     |
| Expo SDK     | 53 (React Native 0.79, React 19)                                           |
| Architecture | [New architecture](https://reactnative.dev/architecture/landing-page) only |

Some features need a newer Android System WebView: [which ones](guides/android-system-webview.md).

## Usage

Pick what you need:

| To                                                                                | See                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Show the URL, progress or a back button                                           | [Navigation state](guides/examples.md#navigation-state)                                                                      |
| Show a spinner and your own error screen                                          | [Loading and error screens](guides/examples.md#loading-and-error-screens)                                                    |
| Keep the WebView on your sites, open the rest externally                          | [Navigation rules](guides/examples.md#navigation-rules)                                                                      |
| Call the page from the app, and the app from the page                             | [The bridge](guides/examples.md#the-bridge)                                                                                  |
| Change a WebView setting, or call a platform method                               | [Use a platform API](guides/platform-apis.md)                                                                                |
| Share cookies with native requests                                                | [Cookies](guides/examples.md#cookies)                                                                                        |
| Run a script on every page                                                        | [Scripts](guides/examples.md#scripts)                                                                                        |
| Load bundled HTML                                                                 | [Local files](guides/examples.md#local-files)                                                                                |
| Answer file pickers, permissions and downloads                                    | [Page requests](guides/examples.md#page-requests)                                                                            |
| Inspect the page's DOM and console                                                | [Debugging the page](guides/examples.md#debugging-the-page)                                                                  |
| Use the native `WKWebView` or `WebView`                                           | [Native hooks](guides/native-hooks.md)                                                                                       |
| Bring back `basicAuthCredential`, `onScroll` and other react-native-webview props | [@react-native-minimal-webview/extensions](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/) |
| Find out why something doesn't work                                               | [Troubleshooting](guides/troubleshooting.md)                                                                                 |

## Contributing

[CONTRIBUTING.md](https://github.com/RasmusKard/react-native-minimal-webview/blob/main/.github/CONTRIBUTING.md) has the setup, the checks and the on-device suites.
