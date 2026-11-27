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

`configuration` is read once, when the WebView is created: a change [recreates the WebView][configuration], and a
`call` on it changes nothing.

| Root            | Android class                                                                                                                                  | Takes                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `settings`      | [`WebSettings`][websettings], then [`WebSettingsCompat`][websettingscompat]                                                                    | settings, `get`, `call` |
| `webView`       | [`WebView`][webview] and its inherited `View` setters, then [`WebViewCompat`][webviewcompat], then `CookieManager`'s `acceptThirdPartyCookies` | settings, `get`, `call` |
| `cookieManager` | [`CookieManager`][cookiemanager]                                                                                                               | `get`, `call`           |
| `webStorage`    | [`WebStorage`][webstorage]                                                                                                                     | `get`, `call`           |

## 2. Write a setting

On iOS the key is the property's name. On Android it is the setter's name without `set`.

| The platform's documentation                     | The prop                                                   |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `WKWebView`, `allowsLinkPreview`                 | `ios={{ webView: { allowsLinkPreview: false } }}`          |
| `UIScrollView`, `bounces`                        | `ios={{ scrollView: { bounces: false } }}`                 |
| `UIScrollView`, `contentOffset`, a `CGPoint`     | `ios={{ scrollView: { contentOffset: { x: 0, y: 80 } } }}` |
| `WebSettings`, `setBuiltInZoomControls(boolean)` | `android={{ settings: { builtInZoomControls: false } }}`   |
| `WebSettings`, `setTextZoom(int)`                | `android={{ settings: { textZoom: 130 } }}`                |

Keys the SDKs list appear in autocomplete, so a misspelled one doesn't compile. A key they lack, such as one a newer SDK
added, goes under the root's `other`: `webView: { other: { someNewerProperty: true } }`, with the property's real
name in place of `someNewerProperty`.

A boolean, number or string is passed as it is. An enum or option set is a number. [`IOSConstants`][iosconstants] and [`AndroidConstants`][androidconstants] name the values of the classes they list; for another class's, such as `View`'s `overScrollMode`, use the number the platform's documentation gives. [`IOSSettings`][iossettings] and
[`AndroidSettings`][androidsettings] list the other value types, the package's defaults for each root, and when a
change applies.

```tsx
import { AndroidConstants, IOSConstants, WebView } from 'react-native-minimal-webview';

<WebView
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  ios={{
    // Let a video autoplay without a tap:
    // WKWebViewConfiguration.mediaTypesRequiringUserActionForPlayback, a WKAudiovisualMediaTypes
    configuration: {
      mediaTypesRequiringUserActionForPlayback: IOSConstants.AudiovisualMediaTypes.none,
    },
  }}
  android={{
    // Show the http images of an https page: WebSettings.setMixedContentMode(int)
    settings: { mixedContentMode: AndroidConstants.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE },
  }}
/>;
```

## 3. Read a value

A `get` or `call` string names one platform's member. Both platforms have a `webView` root, with different properties
and methods, so pick the string by `Platform.OS`.

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
in the arguments: the call resolves with what it reports, for the WebKit methods whose handlers [`call`][call] can
await (one in the package's SDK headers that reports an object, an error or an integer). On Android a trailing
`ValueCallback` works the same way.

The Swift name doesn't work, and often differs: Swift's `takeSnapshot(with:completionHandler:)` is the selector
`takeSnapshotWithConfiguration:completionHandler:`.

[`call`][call] lists how each argument type is written (a struct, an `NSDate`, an `NSSet`, a cookie), what a result
converts to, and the methods the core keeps to itself. Unlike a setting, a call can crash the app: on iOS with an object argument of the wrong class, on Android with a `null` listener or callback other than the trailing `ValueCallback`.

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
[configuration]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/#configuration
