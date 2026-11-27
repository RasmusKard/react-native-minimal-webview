# Android System WebView versions

Some features need a newer Android System WebView than the [minimum Android version](../README.md#requirements)
brings. The WebView updates apart from Android, so a device's API level doesn't tell you its WebView version.

The package has no minimum Android System WebView version. The core checks each feature at run time and turns it off
on an older WebView.

## What needs a newer WebView

| From WebView | Feature                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| 83           | [`evaluate`][evaluate]                                                                                        |
| 83           | `blob:` downloads with [`onDownload`][onDownload]                                                             |
| 101          | The [bridge][bridge]                                                                                          |
| 101          | [`injectedScripts`][injectedScripts]                                                                          |
| 102          | [`canGoBack`][canGoBack] and [`canGoForward`][canGoForward] after an iframe's history entry                   |
| 146          | [`pendingUrl`][pendingUrl]                                                                                    |
| 146          | [`loading`][loading] and [`onLoadStart`][onLoadStart] when a load starts, not when its response arrives       |
| 146          | [`loading`][loading], [`onLoadStart`][onLoadStart] and [`onLoadEnd`][onLoadEnd] for a load that never commits |
| 146          | SSL errors on back/forward loads in [`onError`][onError]                                                      |
| 146          | [`backForwardCacheEnabled`][settings], on by default                                                          |

Each feature's API reference says what it does on an older WebView.

A `WebSettingsCompat` or `WebViewCompat` key, a compat method through `get` or `call`, and `AndroidWebView.preconnect`
depend on an androidx.webkit feature, not on a WebView version. The API reference names the feature for each key and
for `preconnect`.

## Check a device's WebView

Read [`AndroidWebView.defaultUserAgent`][defaultUserAgent]. The WebView version is the number after `Chrome/`.

## Test the oldest versions

Test on an emulator image without the Play Store, such as a `default` or Google APIs image. Its WebView stays at the
version the image shipped with, while the Play Store would update it during your tests. Older API levels ship older
WebViews, so run the app there to see the features above turned off. [CONTRIBUTING][contributing] lists the images the
package's own suites run on.

[evaluate]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#evaluate
[onDownload]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#ondownload
[bridge]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#bridge
[injectedScripts]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#injectedscripts
[canGoBack]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#cangoback
[canGoForward]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#cangoforward
[pendingUrl]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#pendingurl
[loading]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/NavigationState/#loading
[onLoadStart]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onloadstart
[onLoadEnd]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onloadend
[onError]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#onerror
[settings]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/AndroidSettings/#settings
[defaultUserAgent]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/AndroidWebView/#defaultuseragent
[contributing]: https://github.com/RasmusKard/react-native-minimal-webview/blob/main/.github/CONTRIBUTING.md#on-device-suites
