---
title: Use a platform API
---

# Use a platform API

How to get from a property or method in Apple's or Android's documentation to the key, value or `call` string this
package takes. The package doesn't document each platform setting: the platform's own page does.

## 1. Find the root

A root is the native object the setting or method belongs to. The class name in the platform's documentation tells you
which one.

| Root                 | iOS class                                          | Takes                   |
| -------------------- | -------------------------------------------------- | ----------------------- |
| `configuration`      | [`WKWebViewConfiguration`][wkwebviewconfiguration] | settings, `get`         |
| `preferences`        | [`WKPreferences`][wkpreferences]                   | settings, `get`, `call` |
| `webpagePreferences` | [`WKWebpagePreferences`][wkwebpagepreferences]     | settings, `get`, `call` |
| `webView`            | [`WKWebView`][wkwebview]                           | settings, `get`, `call` |
| `scrollView`         | [`UIScrollView`][uiscrollview]                     | settings, `get`, `call` |
| `websiteDataStore`   | [`WKWebsiteDataStore`][wkwebsitedatastore]         | `get`, `call`           |
| `httpCookieStore`    | [`WKHTTPCookieStore`][wkhttpcookiestore]           | `get`, `call`           |

| Root            | Android class                                                               | Takes                   |
| --------------- | --------------------------------------------------------------------------- | ----------------------- |
| `settings`      | [`WebSettings`][websettings], then [`WebSettingsCompat`][websettingscompat] | settings, `get`, `call` |
| `webView`       | [`WebView`][webview], then [`WebViewCompat`][webviewcompat]                 | settings, `get`, `call` |
| `cookieManager` | [`CookieManager`][cookiemanager]                                            | `get`, `call`           |
| `webStorage`    | [`WebStorage`][webstorage]                                                  | `get`, `call`           |

## 2. Write a setting

On iOS the key is the property's name. On Android it is the setter's name without `set`.

| The platform's documentation                     | The prop                                                 |
| ------------------------------------------------ | -------------------------------------------------------- |
| `WKWebView`, `allowsLinkPreview`                 | `ios={{ webView: { allowsLinkPreview: false } }}`        |
| `UIScrollView`, `bounces`                        | `ios={{ scrollView: { bounces: false } }}`               |
| `WebSettings`, `setBuiltInZoomControls(boolean)` | `android={{ settings: { builtInZoomControls: false } }}` |
| `WebSettings`, `setTextZoom(int)`                | `android={{ settings: { textZoom: 130 } }}`              |

The keys the SDKs list autocomplete, so a misspelled one doesn't compile. A key they lack, such as one a newer SDK
added, goes under the root's `other`.

A boolean, number or string is passed as it is. An enum or option set is a number, which
[`IOSConstants`][iosconstants] and [`AndroidConstants`][androidconstants] name. [`IOSSettings`][iossettings] and
[`AndroidSettings`][androidsettings] list the other value types, the package's defaults for each root, and when a
change applies.

```tsx
import { AndroidConstants, IOSConstants, WebView } from 'react-native-minimal-webview';

<WebView
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  ios={{
    // WKWebViewConfiguration.mediaTypesRequiringUserActionForPlayback, a WKAudiovisualMediaTypes
    configuration: {
      mediaTypesRequiringUserActionForPlayback: IOSConstants.AudiovisualMediaTypes.none,
    },
    // a property the generated keys don't list
    webView: { other: { someNewerProperty: true } },
  }}
  android={{
    // WebSettings.setMixedContentMode(int)
    settings: { mixedContentMode: AndroidConstants.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE },
  }}
/>;
```

A key the device can't apply is skipped with a warning, never a crash.

## 3. Read a value

[`get`][get] takes `root.key`. On iOS the key is the property's name, on Android the getter's name without `get` or
`is`: `WebSettings.getTextZoom()` is `get('settings.textZoom')`.

## 4. Call a method

[`call`][call] takes `root.method` and the arguments in order.

On Android the method is the Java method's name: `WebView.clearCache(boolean)` is
`call('webView.clearCache', [true])`.

On iOS it is the Objective-C selector, which Apple's page shows once you switch its language from Swift to
Objective-C. The selector is every argument label of the declaration, each with its colon, joined:

| Objective-C declaration                                                         | The call                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `- (void)flashScrollIndicators;`                                                | `call('scrollView.flashScrollIndicators')`                              |
| `- (void)setContentOffset:(CGPoint)contentOffset animated:(BOOL)animated;`      | `call('scrollView.setContentOffset:animated:', [{ x: 0, y: 0 }, true])` |
| `- (void)getAllCookies:(void (^)(NSArray<NSHTTPCookie *> *))completionHandler;` | `call('httpCookieStore.getAllCookies:')`                                |

A method with no argument has no colon. A trailing completion handler keeps its label in the selector but has no entry
in the arguments: the call resolves with what it reports. On Android a trailing `ValueCallback` works the same way.

The Swift name doesn't work, and often differs: Swift's `takeSnapshot(with:completionHandler:)` is the selector
`takeSnapshotWithConfiguration:completionHandler:`.

[`call`][call] lists how each argument type is written (a struct, an `NSDate`, an `NSSet`, a cookie), what a result
converts to, and the methods the core keeps to itself. Unlike a setting, a call with an argument of the wrong class can
crash the app on iOS.

## When this isn't enough

A method that takes another object, a delegate or client callback, and anything that keeps native state need a
[native hook](native-hooks.md#when-to-write-one).

[wkwebviewconfiguration]: https://developer.apple.com/documentation/webkit/wkwebviewconfiguration
[wkpreferences]: https://developer.apple.com/documentation/webkit/wkpreferences
[wkwebpagepreferences]: https://developer.apple.com/documentation/webkit/wkwebpagepreferences
[wkwebview]: https://developer.apple.com/documentation/webkit/wkwebview
[uiscrollview]: https://developer.apple.com/documentation/uikit/uiscrollview
[wkwebsitedatastore]: https://developer.apple.com/documentation/webkit/wkwebsitedatastore
[wkhttpcookiestore]: https://developer.apple.com/documentation/webkit/wkhttpcookiestore
[websettings]: https://developer.android.com/reference/android/webkit/WebSettings
[websettingscompat]: https://developer.android.com/reference/androidx/webkit/WebSettingsCompat
[webview]: https://developer.android.com/reference/android/webkit/WebView
[webviewcompat]: https://developer.android.com/reference/androidx/webkit/WebViewCompat
[cookiemanager]: https://developer.android.com/reference/android/webkit/CookieManager
[webstorage]: https://developer.android.com/reference/android/webkit/WebStorage
[iosconstants]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/IOSConstants/
[androidconstants]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/AndroidConstants/
[iossettings]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/
[androidsettings]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/AndroidSettings/
[get]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#get
[call]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#call
