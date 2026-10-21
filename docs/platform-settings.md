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

The package's own defaults are plain keys that yours override. JS sends these with your settings:

- Inline video on iOS: `ios.configuration.allowsInlineMediaPlayback` (`true`), so a `<video playsinline>` doesn't open
  fullscreen.
- Debugging in `__DEV__` only: `ios.webView.inspectable`, `android.webView.webContentsDebuggingEnabled` (process-wide).
- No custom user agent: `ios.webView.customUserAgent`, `android.settings.userAgentString` (`null`), unless `userAgent`
  is set.

Script-opened windows (`javaScriptCanOpenWindowsAutomatically`) and playback without a gesture are already off by the
platforms' own defaults.

Android also sets these natively, once for each new WebView (the first, and the one after a renderer crash):

- `javaScriptEnabled`, `domStorageEnabled` and `supportMultipleWindows` on (a new window reaches the navigation rules).
- `allowFileAccess` and `allowContentAccess` off, `mixedContentMode` `MIXED_CONTENT_NEVER_ALLOW`.
- Pinch-zoom on, without the +/- buttons: `builtInZoomControls` on, `displayZoomControls` off.
- `backForwardCacheEnabled` on, so back and forward restore the page as WebKit does (with WebView 146 and newer).
- `downloadFaviconsEnabled` off, where the WebView has the setting (a hook client that overrides `onReceivedIcon` turns
  it back on).

How the keys work:

- **The keys autocomplete**, with their type and `@since`, from the SDK headers (`src/platform.generated.ts`), and the
  platforms' enums and constants come as `WK` (`WK.DataDetectorTypes.link`, `WK.ContentMode.desktop`) and `Android`
  (`Android.WebSettings.LOAD_NO_CACHE`). A key the headers don't list, from a newer SDK, still type-checks.
- **Names are the platform's.** iOS keys are Objective-C property names (`inspectable`, `scrollEnabled`), set with
  Key-Value Coding. Android keys are setter names without `set` (`textZoom` for `setTextZoom`), found by reflection,
  with the `WebSettingsCompat` and `WebViewCompat` statics as fallbacks, so an androidx.webkit feature works the day it
  ships. Enums and option sets are their raw numbers; iOS structs are objects (`contentInset: { top, left, bottom, right }`),
  a `UIColor` is `#rrggbb` or `#rrggbbaa` (`underPageBackgroundColor`), an `NSURL` a string, and `websiteDataStore`
  `'default'` or `'nonPersistent'`.
- **Only public API.** The settings channel uses only public API (the one private value in navigation is in
  [ADR 0003](adr/0003-universal-links-stay-in-place.md)). A key must name a public property or setter that takes the value's type; a private
  (underscore) one is refused. Anything else is skipped with a warning naming the key and the reason, including a
  compat feature this device's WebView lacks. Nothing in this channel can crash the app.
- **Live, except `ios.configuration`**, which WebKit reads once when the WebView is created: a change recreates the
  WebView (the page reloads), as a change of `bridge` does. A key you remove goes back to the package's
  default when JS sends one (the first list above: debugging and the user agent); any other key keeps its value until
  you set it or the WebView is recreated.
- **`get(key)`** reads a value back through JSON (`ERR_NATIVE` if it can't); on iOS `websiteDataStore` and
  `httpCookieStore` are roots too, on Android `cookieManager` and `webStorage`.

## call

`call(method, args?, options?)` calls a platform method, `root.method`, and resolves with its result through JSON
(`ERR_NATIVE` for one it refuses or that fails). Android: a public method of `settings` (then `WebSettingsCompat`'s
statics), `webView` (then `WebViewCompat`'s), `cookieManager` or `webStorage`:

```ts
await ref.current?.call('webView.clearCache', [true]);
await ref.current?.call('cookieManager.removeAllCookies', [null]);
await ref.current?.call('webStorage.deleteAllData');
```

To clear the cache and history on Android: `call('webView.clearCache', [true])` and `call('webView.clearHistory')`. On
iOS, `websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:` (below) clears the cache, with
`WK.WebsiteDataType.diskCache` and `memoryCache`; WebKit has no API to clear the back-forward list.

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
is `null`. Refused with `ERR_NATIVE`: on iOS every selector that loads, navigates, runs a script, starts a download
or sets a delegate, and private (`_`), KVC, KVO (`willChange…`, `didChange…`), `performSelector`, `init…`, `copy…`,
`mutable…`, `new…` and reference-counting selectors; on Android, in `call` and `get`, the loads, navigations, clients,
JavaScript interfaces, web message listeners, document-start scripts, `destroy`, `removeAllViews`, `pauseTimers`,
`resumeTimers` and `evaluateJavascript`. So are an unknown selector, a wrong argument count, an argument that doesn't
fit the signature, a method or getter that raises, and on iOS a result JSON can't carry (a NaN).
Two things the signature can't check are undefined behaviour and crash the app: a wrong completion shape, and an
object argument of the wrong class. For a method that takes an object, write a [native hook](native-hooks.md).
