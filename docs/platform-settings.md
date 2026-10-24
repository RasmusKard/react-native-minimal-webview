# Platform settings

Every platform setting is reachable by its own name through `ios` and `android`, without a change to this package.
The keys autocomplete, and the platforms' enums and constants come as `WK` and `Android`.

```tsx
<WebView
  ios={{
    configuration: { dataDetectorTypes: WK.DataDetectorTypes.link, websiteDataStore: 'nonPersistent' }, // WKWebViewConfiguration: read once, at creation
    preferences: { minimumFontSize: 12 },                                        // WKPreferences
    webpagePreferences: { allowsContentJavaScript: false },                      // WKWebpagePreferences, from the next navigation
    webView: { allowsBackForwardNavigationGestures: true },                      // WKWebView
    scrollView: { bounces: false, contentInsetAdjustmentBehavior: WK.ContentInsetAdjustmentBehavior.never }, // its UIScrollView
  }}
  android={{
    settings: { textZoom: 120, algorithmicDarkeningAllowed: true }, // WebSettings, then WebSettingsCompat
    webView: { overScrollMode: 2, acceptThirdPartyCookies: true },   // WebView, then WebViewCompat, then CookieManager
  }}
/>
const bounces = await ref.current?.get('scrollView.bounces'); // iOS; 'settings.textZoom' on Android
```

- **Names are the platform's:** on iOS Objective-C property names (`inspectable`), set with Key-Value Coding; on
  Android setter names without `set` (`textZoom` for `setTextZoom`), found by reflection, with the `WebSettingsCompat`
  and `WebViewCompat` statics as fallbacks, so an androidx.webkit feature works the day it ships.
- **Only public API:** a key that isn't a public property or setter taking the value's type is skipped with a warning
  naming the key and the reason. Nothing in this channel can crash the app.
- **Live, except `ios.configuration`**, which WebKit reads once: a change recreates the WebView (the page reloads). The
  package's defaults (inline video on iOS, debugging in `__DEV__`, no custom user agent) are plain keys that yours
  override. A removed key returns to the package's default, if any, or keeps its value until the WebView is recreated.

## call

`call(method, args?, options?)` calls `root.method` and resolves with its result through JSON. On iOS the method is
an Objective-C selector, and one that ends in a completion handler needs the handler's shape in `options.completion`:
a wrong shape, or an object argument of the wrong class, crashes the app (for a method that takes another object,
write a [native hook](native-hooks.md)).

```ts
// Android
await ref.current?.call('webView.clearCache', [true]);
await ref.current?.call('webView.clearHistory');
await ref.current?.call('cookieManager.removeAllCookies', [null]);
await ref.current?.call('webStorage.deleteAllData');
// iOS
await ref.current?.call(
  'websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:',
  [{ set: [WK.WebsiteDataType.cookies, WK.WebsiteDataType.localStorage] }, { date: 0 }],
  { completion: 'void' }
);
const pdf = await ref.current?.call('webView.createPDFWithConfiguration:completionHandler:', [null], { completion: 'valueError' }); // base64
const png = await ref.current?.call('webView.takeSnapshotWithConfiguration:completionHandler:', [null], { completion: 'valueError' }); // base64 PNG
await ref.current?.call('scrollView.setContentOffset:animated:', [{ x: 0, y: 200 }, true]);
await ref.current?.call(
  'httpCookieStore.setCookie:completionHandler:',
  [{ cookie: { Name: 'session', Value: 'abc', Domain: 'example.com', Path: '/', 'Max-Age': '3600' } }],
  { completion: 'void' }
);
const cookies = await ref.current?.call('httpCookieStore.getAllCookies:', [], { completion: 'value' }); // [{ Name, Value, Domain, … }]
```
