# Changelog

## [1.3.2](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.3.1...react-native-minimal-webview-v1.3.2) (2026-11-24)


### Bug Fixes

* Send onNavigation through the core hook-event channel, so a throwing handler is logged ([#329](https://github.com/RasmusKard/react-native-minimal-webview/issues/329)) ([8fe0643](https://github.com/RasmusKard/react-native-minimal-webview/commit/8fe0643f9b46ecc3d60132da349aa654d3ab40a5))

## [1.3.1](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.3.0...react-native-minimal-webview-v1.3.1) (2026-11-23)


### Bug Fixes

* Choose Android bridge delivery by the WebView's Chromium version, so a vendor WebView numbered apart from Chromium gets the right one ([#295](https://github.com/RasmusKard/react-native-minimal-webview/issues/295)) ([aa4f13c](https://github.com/RasmusKard/react-native-minimal-webview/commit/aa4f13cc5ae5dfbbaff5034b8166c4ab3e0501de))
* End an Android load that a renderer crash cut off before it committed as failed, not cancelled ([#291](https://github.com/RasmusKard/react-native-minimal-webview/issues/291)) ([07ae44f](https://github.com/RasmusKard/react-native-minimal-webview/commit/07ae44f206841a5b2d70d52a517fbd505fc50ec3))
* Load the 401 page on iOS once a site rejects a credential, instead of sending it again without end ([#298](https://github.com/RasmusKard/react-native-minimal-webview/issues/298)) ([1534f3e](https://github.com/RasmusKard/react-native-minimal-webview/commit/1534f3e376cd7caa74482e6975b479c25eaa65ec))
* Open the Android system file chooser again after the activity that opened the last one was recreated ([#300](https://github.com/RasmusKard/react-native-minimal-webview/issues/300)) ([8b54334](https://github.com/RasmusKard/react-native-minimal-webview/commit/8b5433400781334f5172a4006c4c79bd5fd60e41))
* Report a failed load's url at onLoadEnd on Android System WebView older than 146 ([#311](https://github.com/RasmusKard/react-native-minimal-webview/issues/311)) ([1855b01](https://github.com/RasmusKard/react-native-minimal-webview/commit/1855b014f6e36116b4e9adf008e220ee52366689))
* Update canGoBack and canGoForward on Android when an iframe navigates ([#309](https://github.com/RasmusKard/react-native-minimal-webview/issues/309)) ([c01f156](https://github.com/RasmusKard/react-native-minimal-webview/commit/c01f15638f79536ce1e1bf770c06afe2d91046e9))

## [1.3.0](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.2.1...react-native-minimal-webview-v1.3.0) (2026-11-22)


### Features

* Add HookExtension.onAsk, which takes a hook's asks with a non-optional signal ([#267](https://github.com/RasmusKard/react-native-minimal-webview/issues/267)) ([1e771ac](https://github.com/RasmusKard/react-native-minimal-webview/commit/1e771ac24149b5ced42c665ada397e5d82eadb20))
* Add newWebViewsOnly to Android MinimalWebViewHooks.register, and use it for incognito ([#274](https://github.com/RasmusKard/react-native-minimal-webview/issues/274)) ([a7a100f](https://github.com/RasmusKard/react-native-minimal-webview/commit/a7a100f43ea3c2b95c67b58a2e8e6e6dc8ec248e))


### Bug Fixes

* Deliver Android bridge messages after the commit's document end on WebView before 119, so a new page's early call is answered ([#281](https://github.com/RasmusKard/react-native-minimal-webview/issues/281)) ([dfd07ff](https://github.com/RasmusKard/react-native-minimal-webview/commit/dfd07ff43275c5f09cce5c65ed7dbe4e64301ce6))
* Name the Android download size cap in MiB, the unit it counts ([#273](https://github.com/RasmusKard/react-native-minimal-webview/issues/273)) ([4e94459](https://github.com/RasmusKard/react-native-minimal-webview/commit/4e944590e9306899895478f53af827ee10b651aa))
* Retry a failed iOS load with the read root of the load that failed, not of the last load() at its URL ([#276](https://github.com/RasmusKard/react-native-minimal-webview/issues/276)) ([be65627](https://github.com/RasmusKard/react-native-minimal-webview/commit/be65627d1a67f9bef3e18a5f75091ca92d7d538e))

## [1.2.1](https://github.com/RasmusKard/react-native-minimal-webview/compare/react-native-minimal-webview-v1.2.0...react-native-minimal-webview-v1.2.1) (2026-11-20)


### Bug Fixes

* Complete an iOS alert once when the WebView unmounts or crashes between the OK press and its handler ([#233](https://github.com/RasmusKard/react-native-minimal-webview/issues/233)) ([79d8808](https://github.com/RasmusKard/react-native-minimal-webview/commit/79d8808c493a667674e886d0976d601c40d9c7a8))
* Keep the history on Android when load() or a new source replaces a waiting crash recovery ([#229](https://github.com/RasmusKard/react-native-minimal-webview/issues/229)) ([c88fc19](https://github.com/RasmusKard/react-native-minimal-webview/commit/c88fc19cbefe876458b691e6b30017ebe96c73e1))
* Refuse turning the Android back-forward cache on below WebView 146, where a restored page reports no load end ([#236](https://github.com/RasmusKard/react-native-minimal-webview/issues/236)) ([307758a](https://github.com/RasmusKard/react-native-minimal-webview/commit/307758a3fe352ed829e3fb899a4a4648792e2328))
* Reject an iOS evaluate with navigated when WebKit drops it before the commit ([#225](https://github.com/RasmusKard/react-native-minimal-webview/issues/225)) ([dc635fe](https://github.com/RasmusKard/react-native-minimal-webview/commit/dc635fe8b48dc8136cdf993e55ab6be0f851148a))
* Report a missing Android System WebView through onError instead of a blank view or a crash ([#232](https://github.com/RasmusKard/react-native-minimal-webview/issues/232)) ([5b074cd](https://github.com/RasmusKard/react-native-minimal-webview/commit/5b074cd95be062851e5688d2891083ff583f89e0))
* Retry a failed iOS load() of a file within its directory, as it loaded ([#223](https://github.com/RasmusKard/react-native-minimal-webview/issues/223)) ([3ff26a9](https://github.com/RasmusKard/react-native-minimal-webview/commit/3ff26a944d067621b859338966fe83146122a3ad))
* Stop collecting the iOS own-load entries while a hook delegate decides navigations ([#222](https://github.com/RasmusKard/react-native-minimal-webview/issues/222)) ([b09b27a](https://github.com/RasmusKard/react-native-minimal-webview/commit/b09b27a1ef31728fe2a544b359671176bf43e39c))
* Throw as WebView renders in an app built without its native module, as below iOS 17.0 ([#220](https://github.com/RasmusKard/react-native-minimal-webview/issues/220)) ([1382bf1](https://github.com/RasmusKard/react-native-minimal-webview/commit/1382bf1f28e7d8d35dca4c5be36e73dbdbf64379))

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
