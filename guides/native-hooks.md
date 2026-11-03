---
title: Native hooks
---

# Native hooks

A native hook is Swift or Kotlin in your own Expo module that gets the real `WKWebView` or `WebView` behind a
`<WebView>`. This guide covers when to write one, how to write one, and how it shares the WebView with the core.

## When to write one

Reach for a hook when the props and the ref can't do the job:

| To | Use |
|---|---|
| Change a setting | The [`ios` and `android` props](examples.md#platform-settings) |
| Read a property or call a method once | The ref's [`get` and `call`](examples.md#reading-and-calling) |
| Bring back a react-native-webview prop | An [extension][extensions], a hook someone already wrote |
| Handle WebView callbacks, keep native state, or subclass the WebView | A native hook |

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

In `ios/PageCounter.podspec`, replace the template's `s.platforms` with the core's iOS 17.0, or importing the core
fails to compile, and add the core:

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

Replace the generated `index.ts` with a function that returns the hook's [`HookExtension`][HookExtension], and delete the
generated `src/`, `ios/PageCounterView.swift` and `android/.../PageCounterView.kt`: they hold the template's view and
module wrappers, which nothing uses now.

```ts
import type { HookEvent, HookExtension } from 'react-native-minimal-webview';

type PageLoaded = HookEvent<'pageLoaded', { count: number }>;

export const pageCounter = (onLoaded: (count: number) => void): HookExtension => ({
  key: 'myApp.pageCounter',
  onEvent: (event) => {
    if (event.name !== 'pageLoaded') return; // relative to the key
    onLoaded((event as PageLoaded).payload.count);
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

Then rebuild the app: `npx expo run:ios`, `npx expo run:android`.

## Talk to JS

Everything crosses as JSON.

| Native | JS |
|---|---|
| `context.emit(name, payload)` | The extension's `onEvent` gets `<name>` |
| `context.ask(name, payload, onAnswer)` | `onEvent`'s return value, a promise awaited, is the answer |
| `context.handle(method, handler)` | [`ref.hook(key, method, args)`][hook] resolves with the reply |
| `context.options`, `context.onOptionsChange` | The extension's `options`; a change arrives live |

When an `ask` goes unanswered, and how a failing or silent `handle` handler reaches JS, are on `ask` and `handle` of
`WebViewContext` ([Swift][swiftContext], [Kotlin][kotlinContext]).

## Share the WebView with the core

The core keeps the WebView's own delegate and client slots. Your hook adds to the context's lists instead:

A callback the core also handles reaches the core first, then each hook. A decision, such as whether a navigation loads
or a page gets the camera, goes to the first hook that implements it, and switches off the props that make it, such as
`navigationRules`. The rules are on `WebViewContext`'s `navigationDelegates` ([Swift][swiftContext]) and `clients`
([Kotlin][kotlinContext]).

Leave alone what the core owns, listed on `MinimalWebViewHooks` ([Swift][swift], [Kotlin][kotlin]).

## Lifecycle

| When | What the hook gets |
|---|---|
| A WebView with its key mounts | Android: the `webViewFactory`, if it has one. Then `configure`, if it has one, then `attach` |
| The page ends: a navigation commits, a crash, or unmount | Its `onDocumentEnd` handlers run. Reset per-page state there. |
| Its `options` change | Its `onOptionsChange` handlers run, without a reload |
| Its key turns on after mount | `attach` runs then, unless the hook has `configure` or its own WebView class |
| Its key is removed, or its `options` become null or false | `onOptionsChange` with null: the hook is [off][HookExtension] and stays attached. When it turns on again, `onOptionsChange` runs with the new options. |
| The renderer crashes | iOS: `onDocumentEnd` with `crashed`; the `WKWebView` reloads and nothing attaches again. Android: `onDocumentEnd`, then `onDestroyed`, with `CRASHED`; then the factory, `configure` and `attach` run again, on a new context. |
| The WebView unmounts | `onDocumentEnd`, then `onDestroyed`, with `closing`: clean up there. |

`DocumentEnd` ([Swift][documentend], [Kotlin][documentendkt]) says exactly when a page ends, and what each reason means.
`onDestroyed` says what is still alive when it runs.

## Rules

- Register in `OnCreate`, under a key prefixed with your package's name: `register` on `MinimalWebViewHooks`
  ([Swift][swift], [Kotlin][kotlin]) has the rules.
- Use the context as `WebViewContext` ([Swift][swiftContext], [Kotlin][kotlinContext]) says: some members work from any
  thread, the rest from the main thread.

## Platform differences

| | iOS | Android |
|---|---|---|
| Callbacks go in | `navigationDelegates`, `uiDelegates` | `clients`, `chromeClients`, `touchListeners`, `scrollListeners` |
| `configure` gets | The `WKWebViewConfiguration`, before the view exists | The new `WebView`, before the core sets it up |
| Your own WebView class | `webViewClass:` | `webViewFactory =` |
| `onDestroyed` reasons | `closing` | `closing` and `crashed` |
| Only on this platform | `refreshControl` | `onDownloadStart` |

## Reference

- Native API: the [Swift][swiftModule] and [Kotlin][kotlinPackage] reference, with `MinimalWebViewHooks` and
  `WebViewContext`.
- JS API: [`extensions`][extensionsProp], [`HookExtension`][HookExtension] and [`ref.hook`][hook].
- [sample-extension][sample]: a hook for each seam the core offers, run by the example app's tests.
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
[documentend]: https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/documentend/
[documentendkt]: https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-document-end/
[HookExtension]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/HookExtension/
[extensionsProp]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#extensions
[hook]: https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewRef/#hook
