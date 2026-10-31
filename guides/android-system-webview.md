---
title: Android System WebView versions
---

# Android System WebView versions

Some features need a newer Android System WebView than others. This page lists which; each feature's API reference
says what it does without one.

Android System WebView updates apart from Android, so a device's API level doesn't tell you its WebView.

The core checks each feature at run time. On an older WebView the feature is off, and nothing crashes.

| WebView | Needed for |
|---|---|
| 83 | [`evaluate`][evaluate] |
| 83 | `blob:` downloads with [`onDownload`][onDownload] |
| 101 | The [bridge][bridge] |
| 101 | [`injectedScripts`][injectedScripts] |
| 146 | [`pendingUrl`][pendingUrl] |
| 146 | [`onLoadStart`][onLoadStart] and `onLoadEnd` for a load that never commits: a stop, a download, a 204 or a blocked redirect |
| 146 | SSL errors on back and forward loads in [`onError`][onError] |
| 146 | [`backForwardCacheEnabled`][settings] on by default |

A `WebSettingsCompat` or `WebViewCompat` key, a compat method through `get` or `call`, and `WebView.android.preconnect`
depend on an androidx.webkit feature instead of a WebView version. The keys' and `preconnect`'s TSDoc name it.

[evaluate]: https://rasmuskard.github.io/react-native-minimal-webview/types/WebViewRef.html#evaluate
[onDownload]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#ondownload
[bridge]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#bridge
[injectedScripts]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#injectedscripts
[pendingUrl]: https://rasmuskard.github.io/react-native-minimal-webview/types/NavigationState.html#pendingurl
[onLoadStart]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onloadstart
[onError]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onerror
[settings]: https://rasmuskard.github.io/react-native-minimal-webview/types/AndroidSettings.html#settings
