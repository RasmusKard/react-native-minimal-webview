# Type Alias: WebViewRef

> **WebViewRef** = `object`

A WebView's ref. A handle kept after its WebView unmounted is safe to call: the navigation methods do nothing, and
`evaluate`, `get`, `call` and `hook` reject with `unavailable`.

## Methods

### call()

> **call**(`method`, `args?`, `options?`): `Promise`\<`unknown`\>

Calls a platform method, `root.method`, and resolves with its result through JSON. Android: a public method of
`settings` (then `WebSettingsCompat`'s statics), `webView` (then `WebViewCompat`'s), `cookieManager` or
`webStorage`: `call('webView.clearCache', [true])`. iOS: an Objective-C selector on a root of [IOSSettings](IOSSettings.md),
`websiteDataStore` or `httpCookieStore`: `call('scrollView.setContentOffset:animated:', [{ x: 0, y: 100 }, true])`.

Rejects with `native_error` for an unknown method, a wrong argument count, an argument that doesn't fit, a method
that raises, a result JSON can't carry (iOS: `NaN`), and what the core owns: on iOS every selector that loads,
navigates, runs a script, starts a download or sets a delegate, and private (`_`), KVC, KVO, `performSelector`,
`init…`, `copy…`, `mutable…`, `new…` and reference-counting selectors; on Android (in `get` too) the loads,
navigations, clients, JavaScript interfaces, web message listeners, document-start scripts, `destroy`,
`removeAllViews`, `pauseTimers`, `resumeTimers` and `evaluateJavascript`. On iOS two mistakes the signature can't
catch crash the app: a wrong `completion` shape, and an object argument of the wrong class; for a method that takes
another object, write a native hook.

#### Parameters

##### method

`string`

##### args?

`unknown`[]

The method's arguments. On iOS they are converted by its signature: booleans, numbers, strings, the
structs as objects, `null` for nil, and `{ set: [...] }`, `{ date: seconds }`, `{ data: base64 }` or
`{ cookie: properties }` for an `NSSet`, `NSDate`, `NSData` or `NSHTTPCookie`. A cookie's properties are
`NSHTTPCookie`'s keys: `Name`, `Value`, `Domain` and `Path` are required; `Max-Age` (seconds, as a string),
`Secure`, `HttpOnly` and `SameSite` are some of the optional ones. A tag that can't make its object (`{ data }`
that isn't base64, a `{ cookie }` without a required key) rejects with `native_error`.

##### options?

`completion` (iOS) is the shape of the selector's trailing completion handler: `'void'` for `(void)`
resolves `null`; `'value'` for `(id)` resolves the value; `'valueError'` for `(id, NSError *)` resolves the value
or rejects with the error; `'error'` for `(NSError *)` resolves `null` or rejects with the error.

###### completion?

`"void"` \| `"value"` \| `"valueError"` \| `"error"`

#### Returns

`Promise`\<`unknown`\>

On iOS: numbers, strings, an `NSURL` as a string, an `NSDate` as seconds, `NSData` as base64, a `UIImage`
as a base64 PNG, the structs as objects, an `NSHTTPCookie` as its properties (`Expires` in seconds), and arrays,
sets and dictionaries of them. On Android: primitives, strings, and lists and maps of them. Any other object is
`null`.

***

### evaluate()

> **evaluate**(`script`): `Promise`\<`unknown`\>

Runs an expression (not statements) in the page's main frame and awaits it. Resolves with its value through JSON:
`null` for what JSON can't encode (a function, `NaN`, a cycle), a `Date` as its ISO string. The value is the
page's, so treat it as page data. Rejects with a [CodedError](CodedError.md): `script_error` (with the script's error
message), `navigated` or `unavailable`. There is no timeout: a page can hold a call until it navigates.

#### Parameters

##### script

`string`

#### Returns

`Promise`\<`unknown`\>

***

### get()

> **get**(`key`): `Promise`\<`unknown`\>

A platform setting read by name, through JSON as [call](#call) converts results:
`get('scrollView.bounces')` on iOS, `get('settings.textZoom')` on Android. The roots are those of
[IOSSettings](IOSSettings.md) and [AndroidSettings](AndroidSettings.md), plus `websiteDataStore` and `httpCookieStore` on iOS and
`cookieManager` and `webStorage` on Android. On Android, `textZoom` reads `getTextZoom()`, `isTextZoom()` or a
non-void `textZoom()`. Rejects with `native_error` for one it can't read, or that the core owns.

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`unknown`\>

***

### goBack()

> **goBack**(): `void`

Goes back one page, when `canGoBack`. On Android, as Chrome's back button, it also skips the history entries a page
added without a user gesture (`pushState`, a hash change) and the page that added them.

#### Returns

`void`

***

### goForward()

> **goForward**(): `void`

Goes forward one page, when `canGoForward`.

#### Returns

`void`

***

### hook()

> **hook**(`name`, `method`, `args?`): `Promise`\<`unknown`\>

Calls the `method` handler the native hook `name` registered with `context.handle`, with `args`, and resolves with
its reply; both cross as JSON. Rejects with `hook_not_handled`, or `native_error` when the reply can't cross as
JSON. A handler that never replies leaves the promise pending: nothing settles it on navigation, a crash or
unmount.

#### Parameters

##### name

`string`

##### method

`string`

##### args?

`unknown`[]

#### Returns

`Promise`\<`unknown`\>

***

### reload()

> **reload**(): `void`

Reloads the page; after a failed load, retries the failed URL. Sends a POST `source` again, and resets the crash
guard that stops [crash recovery](ProcessGoneEvent.md#recovered).

#### Returns

`void`

***

### stopLoading()

> **stopLoading**(): `void`

Stops the load: its `outcome` is `cancelled`, or on Android `finished` once the page has arrived.

#### Returns

`void`
