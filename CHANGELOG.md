# Changelog

## [1.2.0](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.1.0...react-native-minimal-webview-v1.2.0) (2026-11-19)


### Features

* Add WebViewRef.load to load a URL in place ([#204](https://github.com/RasmusKard/react-native-minimal-webview/issues/204)) ([2c98388](https://github.com/RasmusKard/react-native-minimal-webview/commit/2c98388daa9009ae99020b79c8c2a3d27e3175ab))


### Bug Fixes

* Check an Android permission request against the committed page's origin, not a pending load's ([#198](https://github.com/RasmusKard/react-native-minimal-webview/issues/198)) ([f64b5b0](https://github.com/RasmusKard/react-native-minimal-webview/commit/f64b5b0738413e901dbc66ad9a3a00ee41104bf9))
* Deliver bridge calls and emits made after a renderer crash to the reloaded page ([#196](https://github.com/RasmusKard/react-native-minimal-webview/issues/196)) ([3658d2b](https://github.com/RasmusKard/react-native-minimal-webview/commit/3658d2b1731466bfe51b8dc6cc2434909b5625ce))
* Keep an Android load going when the page being left fires its load event ([#201](https://github.com/RasmusKard/react-native-minimal-webview/issues/201)) ([c4cb7ed](https://github.com/RasmusKard/react-native-minimal-webview/commit/c4cb7edf71f84bc7dbffdeb303a8be560df5a392))
* Load an iOS html source without putting it through the navigation rules ([#199](https://github.com/RasmusKard/react-native-minimal-webview/issues/199)) ([a55d4f4](https://github.com/RasmusKard/react-native-minimal-webview/commit/a55d4f4c6ddba7e34aa33eff7d162a62cc70b9ca))
* Reject bridge calls that never reached a page with unavailable, not navigated ([#197](https://github.com/RasmusKard/react-native-minimal-webview/issues/197)) ([0ed8e1b](https://github.com/RasmusKard/react-native-minimal-webview/commit/0ed8e1b868277ca3049592ff7e0633a956bf8750))
* Reload an iOS html source as html, not by fetching its baseUrl ([#200](https://github.com/RasmusKard/react-native-minimal-webview/issues/200)) ([d75c4b4](https://github.com/RasmusKard/react-native-minimal-webview/commit/d75c4b40459a56109eeeca788a562c206c825373))
* Reload an iOS page after a web process crash only once the app is back in the foreground ([#206](https://github.com/RasmusKard/react-native-minimal-webview/issues/206)) ([59c596a](https://github.com/RasmusKard/react-native-minimal-webview/commit/59c596acefdbfc9aec6dc1dbd9139bd3b590b63f))

## [1.1.0](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.0.1...react-native-minimal-webview-v1.1.0) (2026-11-18)


### Features

* Accept a bridge schema written with interfaces ([#170](https://github.com/RasmusKard/react-native-minimal-webview/issues/170)) ([3335bfd](https://github.com/RasmusKard/react-native-minimal-webview/commit/3335bfd38bcac03f0f4ddc5bd314c89f17f9c95f))
* Deprecate the file: and line: parameters of MinimalWebViewHooks.register on iOS, which do nothing now ([#181](https://github.com/RasmusKard/react-native-minimal-webview/issues/181)) ([9f9b3d9](https://github.com/RasmusKard/react-native-minimal-webview/commit/9f9b3d9685fe4b4e929382eb6316d262dcac11b0))


### Bug Fixes

* Match a source URL to its page in the form the WebView commits it, so reload sends a POST source again ([#179](https://github.com/RasmusKard/react-native-minimal-webview/issues/179)) ([b25fda2](https://github.com/RasmusKard/react-native-minimal-webview/commit/b25fda2b602afedb75eceb9709435ae52f553c3c))
* Replace a hook registered again under its key, with a warning, instead of crashing or replacing silently ([#180](https://github.com/RasmusKard/react-native-minimal-webview/issues/180)) ([edfa8b7](https://github.com/RasmusKard/react-native-minimal-webview/commit/edfa8b72b4a7fa092da064e4e5e21a42d6959920))

## [1.0.1](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.0.0...react-native-minimal-webview-v1.0.1) (2026-11-18)


### Bug Fixes

* Block every navigation that reaches a hole in a sparse navigationRules array ([#148](https://github.com/RasmusKard/react-native-minimal-webview/issues/148)) ([c68d042](https://github.com/RasmusKard/react-native-minimal-webview/commit/c68d042116d40059b1dd3458ded9ff2efb47f81e))
* Reject a bridge message JSON can't encode at the caller instead of dropping the queue ([#166](https://github.com/RasmusKard/react-native-minimal-webview/issues/166)) ([608635a](https://github.com/RasmusKard/react-native-minimal-webview/commit/608635acebd33861afba1bdfcabe55271c7c15a1))
* Return an Android Set result from get, call and hook replies as an array, not null ([#167](https://github.com/RasmusKard/react-native-minimal-webview/issues/167)) ([c14b623](https://github.com/RasmusKard/react-native-minimal-webview/commit/c14b6235947d18b9e3deff27b8b19a69a3189398))
* Stop a navigation rule with a BigInt or circular value from crashing the WebView render ([#149](https://github.com/RasmusKard/react-native-minimal-webview/issues/149)) ([e209a1c](https://github.com/RasmusKard/react-native-minimal-webview/commit/e209a1c155984c55615f22cb51b107759eb17d64))

## 1.0.0 (2026-11-16)


### Continuous Integration

* Release each package separately with release-please and attach attested tarballs to draft releases ([#140](https://github.com/RasmusKard/react-native-minimal-webview/issues/140)) ([c477bf5](https://github.com/RasmusKard/react-native-minimal-webview/commit/c477bf53fa6ae09302e68c9809dc478d48a7d844))
