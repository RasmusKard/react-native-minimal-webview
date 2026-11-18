# Changelog

## [1.0.1](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.0.0...react-native-minimal-webview-v1.0.1) (2026-11-18)


### Bug Fixes

* Block every navigation that reaches a hole in a sparse navigationRules array ([#148](https://github.com/RasmusKard/react-native-minimal-webview/issues/148)) ([c68d042](https://github.com/RasmusKard/react-native-minimal-webview/commit/c68d042116d40059b1dd3458ded9ff2efb47f81e))
* Reject a bridge message JSON can't encode at the caller instead of dropping the queue ([#166](https://github.com/RasmusKard/react-native-minimal-webview/issues/166)) ([608635a](https://github.com/RasmusKard/react-native-minimal-webview/commit/608635acebd33861afba1bdfcabe55271c7c15a1))
* Return an Android Set result from get, call and hook replies as an array, not null ([#167](https://github.com/RasmusKard/react-native-minimal-webview/issues/167)) ([c14b623](https://github.com/RasmusKard/react-native-minimal-webview/commit/c14b6235947d18b9e3deff27b8b19a69a3189398))
* Stop a navigation rule with a BigInt or circular value from crashing the WebView render ([#149](https://github.com/RasmusKard/react-native-minimal-webview/issues/149)) ([e209a1c](https://github.com/RasmusKard/react-native-minimal-webview/commit/e209a1c155984c55615f22cb51b107759eb17d64))

## 1.0.0 (2026-11-16)


### Continuous Integration

* Release each package separately with release-please and attach attested tarballs to draft releases ([#140](https://github.com/RasmusKard/react-native-minimal-webview/issues/140)) ([c477bf5](https://github.com/RasmusKard/react-native-minimal-webview/commit/c477bf53fa6ae09302e68c9809dc478d48a7d844))
