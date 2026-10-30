---
title: Android System WebView versions
---

# Android System WebView versions

Some features need a newer Android System WebView than others. This page lists which, and what an older one does.

Android System WebView updates apart from Android, through the Play Store, so a device's API level doesn't tell you
its WebView. Huawei and Fire OS devices ship their own builds.

The core checks each feature at run time. On an older WebView the feature is off, and nothing crashes.

| WebView | Needed for | On an older one |
|---|---|---|
| 83 | [`evaluate`][evaluate] | It rejects with `unavailable` |
| 83 | `blob:` downloads with [`onDownload`][onDownload] | They fail |
| 101 | The [bridge][bridge] | Calls reject with `unavailable`, and a warning says so |
| 101 | [`injectedScripts`][injectedScripts] | They don't run, and a warning says so |
| 146 | [`pendingUrl`][pendingUrl] | It is always null |
| 146 | Events of a load that never commits (a stop, a download, a failure) | [`onLoadStart`][onLoadStart] and `onLoadEnd` don't fire |
| 146 | SSL errors on back and forward loads | [`onError`][onError] doesn't get them |

[evaluate]: https://rasmuskard.github.io/react-native-minimal-webview/types/WebViewRef.html#evaluate
[onDownload]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#ondownload
[bridge]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#bridge
[injectedScripts]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#injectedscripts
[pendingUrl]: https://rasmuskard.github.io/react-native-minimal-webview/types/NavigationState.html#pendingurl
[onLoadStart]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onloadstart
[onError]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onerror
