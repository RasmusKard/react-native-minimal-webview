# Changelog

## [1.1.0](https://github.com/RasmusKard/react-native-minimal-webview/compare/extensions-v1.0.0...extensions-v1.1.0) (2026-11-23)


### Features

* Add googleMobileAds(), which registers the WebView with the Google Mobile Ads SDK ([#306](https://github.com/RasmusKard/react-native-minimal-webview/issues/306)) ([1f99581](https://github.com/RasmusKard/react-native-minimal-webview/commit/1f99581e3ecdb38cef0ae1a6e6a2aa6149da56cc))
* Add HookExtension.onAsk, which takes a hook's asks with a non-optional signal ([#267](https://github.com/RasmusKard/react-native-minimal-webview/issues/267)) ([1e771ac](https://github.com/RasmusKard/react-native-minimal-webview/commit/1e771ac24149b5ced42c665ada397e5d82eadb20))
* Add newWebViewsOnly to Android MinimalWebViewHooks.register, and use it for incognito ([#274](https://github.com/RasmusKard/react-native-minimal-webview/issues/274)) ([a7a100f](https://github.com/RasmusKard/react-native-minimal-webview/commit/a7a100f43ea3c2b95c67b58a2e8e6e6dc8ec248e))


### Bug Fixes

* Say that keyboardDisplayRequiresUserAction has no effect from iOS 27, where WebKit doesn't tell the app of a script's focus before a touch ([#299](https://github.com/RasmusKard/react-native-minimal-webview/issues/299)) ([fb5546d](https://github.com/RasmusKard/react-native-minimal-webview/commit/fb5546d60148e271c4c5d51239a2e0832a13aa55))

## 1.0.0 (2026-11-16)


### Continuous Integration

* Release each package separately with release-please and attach attested tarballs to draft releases ([#140](https://github.com/RasmusKard/react-native-minimal-webview/issues/140)) ([c477bf5](https://github.com/RasmusKard/react-native-minimal-webview/commit/c477bf53fa6ae09302e68c9809dc478d48a7d844))
