# Platform settings

Every platform setting is reachable by its own name through `ios` and `android`, without a change to this package.
`userAgent` is the only one with its own prop.

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

The package's own defaults are plain keys that yours override: no script-opened windows
(`javaScriptCanOpenWindowsAutomatically`, in `ios.preferences` and `android.settings`), playback only on a gesture
(`ios.configuration.mediaTypesRequiringUserActionForPlayback`, `android.settings.mediaPlaybackRequiresUserGesture`) and
debugging in `__DEV__` only (`ios.webView.inspectable`, `android.webView.webContentsDebuggingEnabled`, which is
process-wide). Android also restores a page from the back-forward cache on back and forward, as WebKit does
(`android.settings.backForwardCacheEnabled`, on with WebView 146 and newer), and downloads no favicons
(`android.settings.downloadFaviconsEnabled`, where the WebView has the setting; a hook client that overrides
`onReceivedIcon` turns it back on).

- **The keys autocomplete**, with their type and `@since`, from the SDK headers (`src/platform.generated.ts`), and the
  platforms' enums and constants come as `WK` (`WK.DataDetectorTypes.link`, `WK.ContentMode.desktop`) and `Android`
  (`Android.WebSettings.LOAD_NO_CACHE`). A key the headers don't list, from a newer SDK, still type-checks.
- **Names are the platform's.** iOS keys are Objective-C property names (`inspectable`, `scrollEnabled`), set with
  Key-Value Coding. Android keys are setter names without `set` (`textZoom` for `setTextZoom`), found by reflection,
  with the `WebSettingsCompat` and `WebViewCompat` statics as fallbacks, so an androidx.webkit feature works the day it
  ships. Enums and option sets are their raw numbers; iOS structs are objects (`contentInset: { top, left, bottom, right }`).
- **Only public API.** A key must name a public property or setter that takes the value's type; a private
  (underscore) one is refused. Anything else is skipped with a warning naming the key and the reason, including a
  compat feature this device's WebView lacks. Nothing in this channel can crash the app.
- **Live, except `ios.configuration`**, which WebKit reads once when the WebView is created: a change recreates the
  WebView (the page reloads), as a change of `bridge` or `nativeOptions` does. A key you remove is not reset; set the
  default yourself.
- **`get(key)`** reads a value back through JSON (`ERR_NATIVE` if it can't); on iOS `websiteDataStore` and
  `httpCookieStore` are roots too, on Android `cookieManager` and `webStorage`.

## call

`call(method, args?, options?)` calls a platform method, `root.method`, and resolves with its result through JSON
(`ERR_NATIVE` for one it refuses or that fails). Android: a public method of `webView` (then `WebViewCompat`'s
statics), `cookieManager` or `webStorage`:

```ts
await ref.current?.call('webView.clearCache', [true]);
await ref.current?.call('cookieManager.removeAllCookies', [null]);
await ref.current?.call('webStorage.deleteAllData');
```

iOS: an Objective-C selector on a settings root, `websiteDataStore` or `httpCookieStore`, the arguments set by the
method's signature: booleans, numbers, strings, the four structs as objects, `null` for nil, and `{ set: [...] }`,
`{ date: seconds }` or `{ data: base64 }` for an NSSet, NSDate or NSData. A selector that ends in a completion handler
needs the handler's shape in `options.completion`:

| `completion` | The handler | Resolves with |
|---|---|---|
| `'void'` | `(void)` | `null` |
| `'value'` | `(id)` | the value |
| `'valueError'` | `(id, NSError *)` | the value, or rejects with the error |
| `'error'` | `(NSError *)` | `null`, or rejects with the error |

```ts
await ref.current?.call(
  'websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:',
  [{ set: [WK.WebsiteDataType.cookies, WK.WebsiteDataType.localStorage] }, { date: 0 }],
  { completion: 'void' }
);
const pdf = await ref.current?.call('webView.createPDFWithConfiguration:completionHandler:', [null], { completion: 'valueError' }); // base64
const png = await ref.current?.call('webView.takeSnapshotWithConfiguration:completionHandler:', [null], { completion: 'valueError' }); // base64 PNG
await ref.current?.call('scrollView.setContentOffset:animated:', [{ x: 0, y: 200 }, true]);
```

Results come back through JSON: numbers, strings, an `NSURL` as a string, an `NSDate` as seconds, `NSData` as base64,
a `UIImage` as a base64 PNG, the four structs as objects, and arrays, sets and dictionaries of them; any other object
is `null`. Refused with `ERR_NATIVE`: what the core owns (on iOS every selector that loads, navigates, runs a script,
starts a download or sets a delegate; on Android the loads, clients, `destroy` and `evaluateJavascript`), private
(`_`) selectors and KVC, an unknown selector, a wrong argument count and an argument that doesn't fit the signature.
Two things the signature can't check are undefined behaviour and crash the app: a wrong completion shape, and an
object argument of the wrong class. For a method that takes an object, write a [native hook](native-hooks.md).
