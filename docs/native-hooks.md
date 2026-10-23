# Native hooks

Anything the settings can't express is a few lines of Swift or Kotlin in your own Expo module (a
[local module](https://docs.expo.dev/modules/get-started/) in `modules/`, or a package). There is no protocol to
implement: a hook gets the real `WKWebView` or `WebView` and its creation-time configuration, and can chain its own
delegates and clients. `example/modules/sample-extension` is a complete one.

```swift
// iOS, in your module's OnCreate: a hook under the hookOptions key that enables it
MinimalWebViewHooks.register("myPackage.pageCounter", configure: { configuration, context in  // before the WKWebView exists
  configuration.dataDetectorTypes = .phoneNumber
}) { webView, context in                                     // once it exists; return a detach closure or nil
  let counter = PageCounter(context: context)                // a WKNavigationDelegate
  context.navigationDelegates.append(counter)
  context.handle("count") { args, reply in reply(counter.count) }
  context.onOptionsChange { value in /* context.options is the new value */ }
  context.onDocumentEnd { reason in counter.pageEnded() }
  return nil
}
```

```kotlin
// Android, in your module's OnCreate
MinimalWebViewHooks.register("myPackage.pageCounter") { webView, context ->  // each WebView: the first, and any after a crash
  context.clients += PageCounter(context)                                   // a WebViewClient
  null                                                                      // or { reason -> … }, run when it goes away
}
```

```tsx
<WebView hookOptions={{ 'myPackage.pageCounter': { label: 'a' } }} onHookEvent={({ name, payload }) => … } />
await ref.current?.hook('myPackage.pageCounter', 'count');  // the handler's reply
```

- **Registering.** `MinimalWebViewHooks.register(key, configure:, attach:)` from your module's `OnCreate`, before the
  first WebView. Hooks run in registration order. Keys are global: a second registration under a key replaces the
  first and logs a warning, so prefix yours with your package's name. `core` is reserved and refused.
- **`hookOptions`.** A hook attaches to a WebView created with a value for its key other than `null`, `undefined` or
  `false` (JS doesn't send `null` and `undefined`). `context.options` is that value. A later change reaches the
  attached hook live, with no new WebView: its `onOptionsChange` handlers get the new value (null or nil when the key
  is removed), and `context.options` is it from then on. A key added after the WebView was created attaches nothing,
  and a warning says so. On Android the WebView after a renderer crash gets the same hooks, with their current values.
- **Delegates and clients.** A callback that returns a decision goes to the first hook delegate (client) that
  implements it, and the core steps aside; every other callback reaches the core first, then every hook that
  implements it. The decisions are `DelegateProxy.decisions` (iOS) and the `deciding(` calls in
  `MinimalWebViewClients.kt` (Android). So a client that overrides `shouldOverrideUrlLoading` switches the navigation
  rules off for that WebView, and a delegate that takes the response policy also switches off `onError`'s `http`
  errors, `onDownload` and opening an untaken download externally. On iOS, an observation callback that neither the core nor
  `DelegateProxy` implements goes to the first delegate only. Android's `shouldInterceptRequest` runs on a background
  thread. Overriding `WebViewClientCompat`'s `onReceivedError`, `onSafeBrowsingHit` or
  `shouldOverrideUrlLoading(WebView, String)` variant counts as overriding the callback that forwards to it.
- **Events.** `context.emit(name, payload)` sends `onHookEvent({ name: '<key>.<name>', payload })`.
  `context.ask(name, payload) { answer in … }` waits for the handler's return value (a promise is awaited; a throw or
  no handler answers null), with no timeout: one still open when the Document ends is answered null.
- **Calls from JS.** `context.handle(method) { args, reply in … }` answers `ref.hook(key, method, args)`; call `reply`
  once. One handler per method, the last one wins. The promise rejects with `hook_not_handled` when no attached hook
  under the key handles the method. The arguments and the reply cross as JSON.
- **Values** arrive as the platform's JSON types: a number as `Double` or `Int` (Kotlin) or `NSNumber` (Swift), an
  object as `Map` or `NSDictionary`, `null` as null or nil (`NSNull` inside a Swift array).
- **The page.** `context.url` is the committed URL, the one `useWebViewState` reports. `context.onDocumentEnd { reason in … }`
  runs at each end of the Document (`committed`, `crashed`, `closing`) after the core's own resets: per-page state
  belongs there.
- **Lifecycle.** iOS: `configure` runs after the `ios.configuration` settings and before the bridge, so replacing the
  user content controller is fine and user scripts you add stay, after the package's. Android: `configure` runs as
  soon as the WebView is made, before the package sets it up (`WebViewCompat.setProfile` goes here). `attach` runs once
  the WebView exists and its settings are applied, so what it sets wins over the settings it was created with. The
  closure `attach` returns runs when that WebView goes away; on Android it gets `CRASHED` or `CLOSING`. Handlers
  belong to one attach: Android attaches again after a crash, on a new WebView, and the new `attach` registers them
  again. Everything runs on the main thread. Set delegates in `attach`: WebKit reads what a delegate responds to when
  it is assigned, and the core re-assigns itself after each change to the lists. On iOS a context kept after its
  WebView went away does nothing, and its `ask` answers nil.
- **What not to touch:** the WebView's own delegate and client slots (use the lists), the bridge's script message
  handler and user scripts, and Android's download listener. `MinimalWebViewHooks.webViewClass` (iOS) and
  `webViewFactory` (Android) let a subclass override what the platform class allows.
