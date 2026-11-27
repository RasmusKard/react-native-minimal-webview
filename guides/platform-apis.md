# Use a platform API

How to get from a property or method in Apple's or Android's documentation to the key, value or `call` string this
package takes. What each setting does is on the platform's own page.

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

The package types each key the platform SDKs declare, so autocomplete offers them and a misspelled one doesn't compile.
A key the types lack, such as one a newer SDK added, goes under the root's `other`: `webView: { other: { someNewerProperty: true } }`.

A boolean, number or string is passed as it is. An enum or option set is a number. [`IOSConstants`][iosconstants] and
[`AndroidConstants`][androidconstants] name the values of the classes they list. For another class, such as `View`'s
`overScrollMode`, use the number the platform's documentation gives. [`IOSSettings`][iossettings] and
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

On iOS it is the Objective-C selector. Apple's page shows the Objective-C declaration when you switch its language to
Objective-C. The selector is every argument label of the declaration, each with its colon, joined:

| Objective-C declaration                                                         | The call                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `- (void)flashScrollIndicators;`                                                | `call('scrollView.flashScrollIndicators')`                              |
| `- (void)setContentOffset:(CGPoint)contentOffset animated:(BOOL)animated;`      | `call('scrollView.setContentOffset:animated:', [{ x: 0, y: 0 }, true])` |
| `- (void)getAllCookies:(void (^)(NSArray<NSHTTPCookie *> *))completionHandler;` | `call('httpCookieStore.getAllCookies:')`                                |

A method with no argument has no colon. A trailing completion handler keeps its label in the selector but has no entry
in the arguments, and the call resolves with what the handler reports. On Android a trailing `ValueCallback` works the
same way.

The Swift name doesn't work. It often differs from the selector, as Swift's `takeSnapshot(with:completionHandler:)`
is `takeSnapshotWithConfiguration:completionHandler:`.

[`call`][call] lists how each argument type is written, what a result converts to, and the methods the core keeps to
itself. Unlike a setting, a call can crash the app. On iOS an object argument of the wrong class crashes it, and on
Android a `null` listener or callback other than the trailing `ValueCallback` does.

## When this isn't enough

A method that takes another object, a delegate or client callback, or anything that keeps native state needs a
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
