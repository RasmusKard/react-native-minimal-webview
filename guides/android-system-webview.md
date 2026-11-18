# Android System WebView versions

Some features need a newer Android System WebView than the [minimum Android version](../README.md#requirements)
brings.

Android System WebView updates apart from Android, so a device's API level doesn't tell you its WebView.

The package has no minimum Android System WebView version. The core checks each feature at run time and turns it off
on an older WebView. The oldest a device can have is 74, which Android 10 (API 29) shipped with: there every feature
in the table below is off.

## What needs a newer WebView

| From WebView | Feature                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| 83           | [`evaluate`][evaluate]                                                                                        |
| 83           | `blob:` downloads with [`onDownload`][onDownload]                                                             |
| 101          | The [bridge][bridge]                                                                                          |
| 101          | [`injectedScripts`][injectedScripts]                                                                          |
| 146          | [`pendingUrl`][pendingUrl]                                                                                    |
| 146          | [`loading`][loading] and [`onLoadStart`][onLoadStart] when a load starts, not when its response arrives       |
| 146          | [`loading`][loading], [`onLoadStart`][onLoadStart] and [`onLoadEnd`][onLoadEnd] for a load that never commits |
| 146          | SSL errors on back/forward loads in [`onError`][onError]                                                      |
| 146          | [`backForwardCacheEnabled`][settings], on by default                                                          |

Each feature's API reference says what it does on an older WebView.

A `WebSettingsCompat` or `WebViewCompat` key, a compat method through `get` or `call`, and `AndroidWebView.preconnect`
depend on an androidx.webkit feature instead of an Android System WebView version. The API reference names it for each key and for `preconnect`.

## Check a device's WebView

The version is the Chrome version in the WebView's user agent: read
[`AndroidWebView.defaultUserAgent`][defaultUserAgent] and look for `Chrome/<version>`.

On a connected device, `adb shell dumpsys webviewupdate` names the WebView package in use and its version.

## Test the oldest versions

Test on an emulator with a system image that has no Play Store (`default` or Google APIs): it keeps the WebView it
shipped with, while the Play Store updates WebView in the background and moves its version under your tests. The
images of older API levels ship older WebViews: run the app there to see the features above off. The API 29 `default`
image has Android System WebView 74. [CONTRIBUTING][contributing] lists the images its suites run on and how to create
the emulators.

[evaluate]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#evaluate
[onDownload]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#ondownload
[bridge]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#bridge
[injectedScripts]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#injectedscripts
[pendingUrl]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#pendingurl
[loading]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#loading
[onLoadStart]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onloadstart
[onLoadEnd]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onloadend
[onError]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onerror
[settings]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/AndroidSettings/#settings
[defaultUserAgent]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/AndroidWebView/#defaultuseragent
[contributing]: https://github.com/RasmusKard/react-native-minimal-webview/blob/main/.github/CONTRIBUTING.md#on-device-suites
