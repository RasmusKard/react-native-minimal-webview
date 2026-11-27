# react-native-minimal-webview

A React Native WebView that hands you the iOS and Android WebView APIs, instead of wrapping each one in a prop.

It runs on iOS and Android as an Expo module.

**[Get started](guides/getting-started.md)** ·
[Examples](guides/examples.md) ·
[API reference](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/) ·
[Migrating from react-native-webview](guides/migrating-from-react-native-webview.md)

## Why it exists

react-native-webview wraps each platform API in a prop of its own. When one isn't wrapped, you wait for an upstream
PR, or patch or fork the package, even if the change is one platform call.

This package passes the platform APIs through instead:

- The `ios` and `android` props set any setting by its platform name.
- The ref's `get` and `call` read any property and call any method by name.
- [Native hooks](guides/native-hooks.md) hand the `WKWebView` or `WebView` itself to your own Swift or Kotlin
  module.

```tsx
import { useRef } from 'react';
import { Button, Platform } from 'react-native';
import { WebView, type WebViewRef } from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  // A method string names one platform's method
  const scrollToTop = () =>
    Platform.OS === 'ios'
      ? ref.current?.call('scrollView.setContentOffset:animated:', [{ x: 0, y: 0 }, true])
      : ref.current?.call('webView.pageUp', [true]); // WebView.pageUp(boolean): true goes to the top
  return (
    <>
      <Button title="Top" onPress={scrollToTop} />
      <WebView
        ref={ref}
        source={{ uri: 'https://example.com' }}
        style={{ flex: 1 }}
        ios={{ webView: { allowsBackForwardNavigationGestures: true } }} // swipe from the edge to go back
        android={{ settings: { builtInZoomControls: false } }} // no pinch zoom
      />
    </>
  );
}
```

A setting from a newer SDK goes under its root's `other` key, and `call` takes any public method. Neither waits for a
release of this package. The reference for
[`ios`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#ios),
[`android`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#android) and
[`call`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#call)
has the details.

## What the core adds

The core adds only what the platform APIs lack. [How it works](guides/how-it-works.md) explains the parts.

- [`navigationRules`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules)
  decide navigations in native code, and ask JS only where a prop says so.
- [`createBridge`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/functions/createBridge/)
  makes a typed promise bridge between the app and the page. The page reaches it as `window.nativeBridge`, which
  exists only on the bridge's
  [`allowedOrigins`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/BridgeOptions/#allowedorigins).
- [`useWebViewState(ref)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/functions/useWebViewState/)
  returns the navigation state.
- [`onPermissionRequest`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onpermissionrequest)
  lets your app answer the page's requests for the camera, the microphone or the location.

## When to use something else

- This package needs the new architecture and runs only on iOS and Android. For the old architecture, Windows or
  macOS, use react-native-webview.
- The package has native code, so it doesn't run in Expo Go. It needs a
  [development build](https://docs.expo.dev/develop/development-builds/introduction/).

## Install

[Get started](guides/getting-started.md) walks you through a new Expo app with a WebView on screen.

In an Expo app, install the package and expo-build-properties:

```sh
npx expo install react-native-minimal-webview expo-build-properties
```

Set the iOS and Android [minimums](#requirements) in `app.json` before you rebuild. Below iOS 17.0, the build leaves out
the package's native module, and `WebView` throws as it renders.

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

In a bare React Native app, add Expo modules first, then install the package. Set the minimums in `ios/Podfile`
(`platform :ios, '17.0'`) and `android/build.gradle` (`minSdkVersion = 29`) before you run `pod-install`:

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

Some features need a newer Android System WebView.
[Android System WebView versions](guides/android-system-webview.md) lists them.

## Usage

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
