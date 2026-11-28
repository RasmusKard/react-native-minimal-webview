# Native hooks

A native hook is Swift or Kotlin in your own Expo module that gets the native `WKWebView` or `WebView` behind a
`<WebView>`. Its JS side is an _extension_, a [`HookExtension`][HookExtension] with the hook's key, its options and its
`onEvent` and `onAsk` handlers. The app passes it in the `extensions` prop.

## When to write one

Write a hook when the props and the ref can't do the job:

| To                                                                   | Use                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Change a setting                                                     | The [`ios` and `android` props](platform-apis.md#2-write-a-setting) |
| Read a property or call a method once                                | The ref's [`get` and `call`](examples.md#reading-and-calling)       |
| Bring back a react-native-webview prop                               | A hook from [@react-native-minimal-webview/extensions][extensions]  |
| Handle WebView callbacks, keep native state, or subclass the WebView | A native hook                                                       |

A hook can implement any delegate or client callback. It runs natively, with no JS round trip.

## How a hook works

1. Your module registers the hook under a key when the app starts.
2. The app turns the hook on for a WebView by passing its extension in the `extensions` prop;
   [`HookExtension.options`][HookExtension] says when it is on or off.
3. The core calls the hook's `attach` with the native WebView and a context.
4. The hook adds its delegates or clients to the context, talks to JS through it, and registers its cleanup with
   `context.onDestroyed`.

## Write a hook

This builds a hook that counts page loads, reports each one to JS, and answers `ref.hook` calls. It is a trimmed
`sample.pageCounter` from [sample-extension][sample].

### 1. Create a module

```sh
npx create-expo-module@latest --local page-counter
```

This creates `modules/page-counter` in your app. A hook in a published package works the same way, with
`react-native-minimal-webview` as a peer dependency.

### 2. Depend on the core

In `ios/PageCounter.podspec`, set `s.platforms` to the core's minimum, iOS 17.0, and add the core. With a lower
minimum, importing the core fails to compile.

```ruby
s.platforms = { :ios => '17.0' }
s.dependency 'MinimalWebView'
```

In the module's `android/build.gradle`:

```groovy
dependencies {
  implementation project(':react-native-minimal-webview')
}
```

### 3. Register the hook on iOS

In `ios/PageCounterModule.swift`:

```swift
import ExpoModulesCore
import MinimalWebView
import WebKit

public class PageCounterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PageCounter")
    OnCreate {
      // The first argument is the WKWebView, which this hook doesn't use
      MinimalWebViewHooks.register("myApp.pageCounter") { _, context in
        let counter = PageCounter(context: context)
        context.navigationDelegates.append(counter)
        context.handle("count") { _, reply in reply(counter.count) }
      }
    }
  }
}

private final class PageCounter: NSObject, WKNavigationDelegate {
  private let context: WebViewContext
  private(set) var count = 0

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    count += 1
    context.emit("pageLoaded", ["count": count])
  }
}
```

### 4. Register the hook on Android

In `android/src/main/java/expo/modules/pagecounter/PageCounterModule.kt`:

```kotlin
package expo.modules.pagecounter

import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.minimalwebview.MinimalWebViewHooks
import expo.modules.minimalwebview.WebViewContext

class PageCounterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PageCounter")
    OnCreate {
      // The first argument is the WebView, which this hook doesn't use
      MinimalWebViewHooks.register("myApp.pageCounter") { _, context ->
        val counter = PageCounter(context)
        context.clients += counter
        context.handle("count") { _, reply -> reply(counter.count) }
      }
    }
  }
}

private class PageCounter(private val context: WebViewContext) : WebViewClient() {
  var count = 0
    private set

  override fun onPageFinished(view: WebView, url: String?) {
    count += 1
    context.emit("pageLoaded", mapOf("count" to count))
  }
}
```

### 5. Describe the hook to JS

Replace the generated `index.ts` with a function that returns the hook's [`HookExtension`][HookExtension]. Delete the
generated `src/`, `ios/PageCounterView.swift` and `android/.../PageCounterView.kt`, which the hook doesn't use.

```ts
import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

type PageLoaded = HookEvent<'pageLoaded', { count: number }>;

export const pageCounter = (onLoaded: (count: number) => void): HookExtension<PageLoaded> => ({
  key: 'myApp.pageCounter',
  onEvent: (event) => {
    if (event.name !== 'pageLoaded') return;
    onLoaded(event.payload.count);
  },
});
```

### 6. Use it

Pass the extension in the WebView's [`extensions`][extensionsProp] prop:

```tsx
import { useRef, useState } from 'react';
import { Button } from 'react-native';
import { WebView, type WebViewRef } from 'react-native-minimal-webview';

import { pageCounter } from '../modules/page-counter';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const [count, setCount] = useState(0);
  const logCount = async () => {
    console.log(await ref.current?.hook('myApp.pageCounter', 'count')); // the handler's reply
  };
  return (
    <>
      <Button title={`${count} pages`} onPress={logCount} />
      <WebView
        ref={ref}
        source={{ uri: 'https://example.com' }}
        style={{ flex: 1 }}
        extensions={[pageCounter(setCount)]}
      />
    </>
  );
}
```

Then rebuild the app.

## Talk to JS

Everything crosses as JSON. `WebViewContext` ([Swift][swiftContext], [Kotlin][kotlinContext]) says which native types
values from JS arrive as, what happens to an unanswered `ask`, and what happens when a `handle` handler fails or never
replies.

| Native                                          | JS                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `context.emit(name, payload)`                   | `onEvent` gets an event with that `name` and `payload`                                                                       |
| `context.ask(name, payload, onAnswer)`          | `onAsk` gets the same, or `onEvent` when there is no `onAsk`. Its return value, awaited if it is a promise, is the answer.   |
| `context.handle(method, handler)`               | [`ref.hook(key, method, args)`][hook] resolves with `reply(value)`, or rejects with `handler_error` on `reply.fail(message)` |
| `context.options`, `context.onOptions(handler)` | The extension's `options`: the handler gets them at once, then each change                                                   |

## Share the WebView with the core

The core owns the WebView's delegate and client slots, so your hook adds its delegates and clients to the context's
lists instead. `MinimalWebViewHooks` ([Swift][swift], [Kotlin][kotlin]) lists what else a hook must leave alone.

`WebViewContext`'s `navigationDelegates` ([Swift][swiftNavigationDelegates]) and `clients` ([Kotlin][kotlinClients])
say which callbacks reach the core first and which decisions a hook takes over from the core and the props.

## Lifecycle

| When                                                     | What runs                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The WebView mounts with the hook's key                   | `webViewClass` (iOS) or `webViewFactory` (Android) and `configure` if the hook has them, then `attach`               |
| The hook's key turns on after mount                      | `attach`, unless the hook has `configure` or its own WebView class, or, on Android, `newWebViewsOnly`                |
| The hook's `options` change, or the hook turns off or on | `onOptions` handlers ([Swift][swiftOnOptions], [Kotlin][kotlinOnOptions])                                            |
| The page ends: a navigation commits, a crash, or unmount | `onDocumentEnd` handlers ([Swift][swiftOnDocumentEnd], [Kotlin][kotlinOnDocumentEnd])                                |
| The renderer crashes (Android)                           | `onDestroyed` handlers ([Kotlin][kotlinOnDestroyed]), then the factory, `configure` and `attach` for the new WebView |
| The WebView unmounts                                     | `onDestroyed` handlers ([Swift][swiftOnDestroyed], [Kotlin][kotlinOnDestroyed])                                      |

`register` on `MinimalWebViewHooks` ([Swift][swiftRegister], [Kotlin][kotlinRegister]) says what `webViewClass`,
`webViewFactory`, `configure`, `attach` and `newWebViewsOnly` get and do. `DocumentEnd` ([Swift][documentend],
[Kotlin][documentendkt]) says when a page ends and what each reason means.

## Registering and threading

- Register in `OnCreate`, under a key prefixed with your package's name: `register` on `MinimalWebViewHooks`
  ([Swift][swift], [Kotlin][kotlin]) has the rules.
- Use the context as `WebViewContext` ([Swift][swiftContext], [Kotlin][kotlinContext]) says: some members work from any
  thread, the rest from the main thread.

## Platform differences

| Hook API               | iOS                                                  | Android                                                         |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Callbacks go in        | `navigationDelegates`, `uiDelegates`                 | `clients`, `chromeClients`, `touchListeners`, `scrollListeners` |
| `configure` gets       | The `WKWebViewConfiguration`, before the view exists | The new `WebView`, before the core sets it up                   |
| Your own WebView class | `webViewClass:`                                      | `webViewFactory =`                                              |
| Only on this platform  | `refreshControl`                                     | `onDownloadStart`                                               |

## Reference

- Native API: the [Swift][swiftModule] and [Kotlin][kotlinPackage] reference, with `MinimalWebViewHooks` and
  `WebViewContext`.
- JS API: [`extensions`][extensionsProp], [`HookExtension`][HookExtension] and [`ref.hook`][hook].
- [sample-extension][sample]: a hook for each part of the hook API, which the example app's tests run.
- [@react-native-minimal-webview/extensions][extensions]: ready-made hooks. Its README shows how to copy one into your
  own module.

[extensions]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/
[sample]: https://github.com/RasmusKard/react-native-minimal-webview/tree/main/example/modules/sample-extension
[swiftModule]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/
[kotlinPackage]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/
[swift]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/minimalwebviewhooks/
[kotlin]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-minimal-web-view-hooks/
[swiftContext]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/webviewcontext/
[kotlinContext]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-web-view-context/
[swiftNavigationDelegates]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/webviewcontext/navigationdelegates/
[kotlinClients]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-web-view-context/clients/
[swiftOnOptions]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/webviewcontext/onoptions(_-)/
[kotlinOnOptions]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-web-view-context/on-options/
[swiftOnDocumentEnd]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/webviewcontext/ondocumentend(_-)/
[kotlinOnDocumentEnd]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-web-view-context/on-document-end/
[swiftOnDestroyed]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/webviewcontext/ondestroyed(_-)/
[kotlinOnDestroyed]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-web-view-context/on-destroyed/
[swiftRegister]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/minimalwebviewhooks/register(_-webviewclass-configure-attach-)/
[kotlinRegister]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-minimal-web-view-hooks/register/
[documentend]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/documentend/
[documentendkt]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-document-end/
[HookExtension]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/
[extensionsProp]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#extensions
[hook]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#hook
