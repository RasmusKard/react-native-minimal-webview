# Native hooks

Anything the settings can't express is a few lines of Swift or Kotlin in your own Expo module (a
[local module](https://docs.expo.dev/modules/get-started/) in `modules/`, or a package). There is no protocol to
implement: a hook gets the real `WKWebView` or `WebView` and its creation-time configuration, and can chain its own
delegates and clients. `example/modules/sample-extension` is a complete one.

```swift
// iOS, in your module's OnCreate: a hook under the nativeOptions key that enables it
MinimalWebViewHooks.configure["pageCounter"] = { configuration, context in   // before the WKWebView exists
  configuration.dataDetectorTypes = .phoneNumber
}
MinimalWebViewHooks.attach["pageCounter"] = { webView, context in             // once it exists; return a detach closure or nil
  context.navigationDelegates.append(PageCounter(context: context))
  return nil
}
```

```kotlin
// Android, in your module's OnCreate
MinimalWebViewHooks.attach["pageCounter"] = { webView, context ->             // for each WebView: the first, and any after a crash
  context.clients += PageCounter(context)  // a WebViewClient
  null
}
```

```tsx
<WebView nativeOptions={{ pageCounter: true }} onNativeEvent={({ name, payload }) => … } />  // name: 'pageCounter.pageLoaded'
```

- **`nativeOptions`** enables hooks: a hook runs for a WebView whose `nativeOptions` has its key, and `context.options`
  is the whole prop, so the key's value can configure it. Read when the WebView is created, like `bridge`: a change
  recreates it. Keys are global, and a later registration under the same key silently replaces the earlier one: a
  package should prefix its keys with its name (`myPackage.pageCounter`).
- **Delegates and clients.** A callback the core doesn't implement goes to the first of your delegates (clients) that
  does. A decision callback the core implements goes to the first of yours that does, and the core steps aside: on iOS
  navigation and response policy, a new window, JS dialogs and media capture; on Android
  `shouldOverrideUrlLoading`, HTTP auth, SSL errors, permissions, geolocation, fullscreen, a new window and the file
  chooser. An observation callback the core implements reaches the core first, then every one of yours. So a client
  that overrides `shouldOverrideUrlLoading` switches the navigation rules off for that WebView, and one that overrides
  `onPageFinished` is just told. Android's `shouldInterceptRequest` runs on a background thread, as always. A client
  may extend `WebViewClientCompat`: overriding its `onReceivedError`, `onSafeBrowsingHit` or
  `shouldOverrideUrlLoading(WebView, String)` variant counts as overriding the platform callback that forwards to it.
- **Events.** `context.emit(name, payload)` sends `onNativeEvent({ name: '<hook>.<name>', payload })`: the hook's key
  is the prefix, so names never collide with the package's (`core.`) or another hook's. `context.ask(name, payload) { answer in … }`
  waits for the handler's return value (a promise is awaited; a throw or no handler answers null).
- **Lifecycle.** `configure` runs after the `ios.configuration` settings and before the bridge, so replacing the
  user content controller is fine. `attach` runs once the WebView exists (on Android also for the new WebView after a
  renderer crash); the closure it returns runs when that WebView goes away. Everything runs on the main thread. Set
  delegates in `attach`: WebKit reads what a delegate responds to when it is assigned, and the core re-assigns itself
  after each change to the lists.
- **What not to touch:** the WebView's own delegate and client slots (use the lists), the bridge's script message
  handler and user scripts, and Android's download listener. `MinimalWebViewHooks.webViewClass` (iOS) and
  `webViewFactory` (Android) let a subclass override what the platform class allows.
