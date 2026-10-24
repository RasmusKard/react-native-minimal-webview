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
  null                                                                      // or { … }, run when it goes away
}
```

```tsx
<WebView hookOptions={{ 'myPackage.pageCounter': { label: 'a' } }} onHookEvent={({ name, payload }) => … } />
await ref.current?.hook('myPackage.pageCounter', 'count');  // the handler's reply
```

To switch a hook on and off, enable its key from the start and put the switch in its value (`{ enabled: false }`): a
key added after the WebView was created attaches nothing. A key with no hook registered under it warns, so pass a
one-platform hook's key on that platform only.

The API is documented on `MinimalWebViewHooks` and `WebViewContext` (`ios/Hooks.swift`,
`android/src/main/java/expo/modules/minimalwebview/Hooks.kt`): registering, `hookOptions`, which callbacks reach a
hook's delegates and clients, events, calls from JS, and the lifecycle.

**What not to touch:** the WebView's own delegate and client slots (use the context's lists), the bridge's script
message handler and user scripts, and Android's download listener. `MinimalWebViewHooks.webViewClass` (iOS) and
`webViewFactory` (Android) let a subclass override what the platform class allows.
