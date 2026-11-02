---
title: Android System WebView versions
---

# Android System WebView versions

Some features need a newer Android System WebView than the [minimum Android version](../README.md#requirements)
brings. This page says why the version matters, how to check and update a device's, and how to test the old ones.
Each item's API reference gives the version it needs.

Android System WebView updates apart from Android, so a device's API level doesn't tell you its WebView.

The core checks each feature at run time. On an older WebView the feature is off, and nothing crashes.

## What needs a newer WebView

- [`evaluate`][evaluate]
- `blob:` downloads with [`onDownload`][onDownload]
- The [bridge][bridge]
- [`injectedScripts`][injectedScripts]
- [`pendingUrl`][pendingUrl]
- [`onLoadStart`][onLoadStart] and `onLoadEnd` for a load that never commits
- SSL errors on back and forward loads in [`onError`][onError]
- [`backForwardCacheEnabled`][settings] on by default

A `WebSettingsCompat` or `WebViewCompat` key, a compat method through `get` or `call`, and `WebView.android.preconnect`
depend on an androidx.webkit feature instead of a WebView version. The keys' and `preconnect`'s TSDoc name it.

## Check a device's WebView

The version is the Chrome version in the WebView's user agent: read
[`WebView.android.defaultUserAgent`][defaultUserAgent] and look for `Chrome/<version>`.

On a connected device, `adb shell dumpsys webviewupdate` names the WebView package in use and its version.

## Update a device's WebView

Update Android System WebView in the Play Store. On an emulator, use a Google APIs system image: a Play Store image
updates WebView in the background, so its version moves under your tests.

## Test the oldest versions

An emulator with a Google APIs image keeps the WebView its image shipped with, and the images of older API levels ship
older WebViews. Run the app there to see the features above off. [CONTRIBUTING][contributing] lists the images for the
oldest supported versions and how to create the emulators.

[evaluate]: https://rasmuskard.github.io/react-native-minimal-webview/types/WebViewRef.html#evaluate
[onDownload]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#ondownload
[bridge]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#bridge
[injectedScripts]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#injectedscripts
[pendingUrl]: https://rasmuskard.github.io/react-native-minimal-webview/types/NavigationState.html#pendingurl
[onLoadStart]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onloadstart
[onError]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#onerror
[settings]: https://rasmuskard.github.io/react-native-minimal-webview/types/AndroidSettings.html#settings
[defaultUserAgent]: https://rasmuskard.github.io/react-native-minimal-webview/variables/WebView.android.defaultUserAgent.html
[contributing]: https://github.com/RasmusKard/react-native-minimal-webview/blob/main/.github/CONTRIBUTING.md#on-device-suites
