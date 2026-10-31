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
2. The app turns the hook on for a WebView by putting its key in `hookOptions`, usually through `useExtensions`.
3. The core calls the hook's `attach` with the native WebView and a context.
4. The hook adds its delegates or clients to the context, and talks to JS through it.

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
        return nil // or a closure, run when the WebView goes away
      }
    }
  }
}

private final class PageCounter: NSObject, WKNavigationDelegate {
  private weak var context: WebViewContext? // weak: the context's handlers hold this object
  private(set) var count = 0

  init(context: WebViewContext) {
    self.context = context
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    count += 1
    context?.emit("pageLoaded", ["count": count])
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
        null // or a closure, run when the WebView goes away
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

type PageLoaded = HookEvent<'myApp.pageCounter.pageLoaded', { count: number }>;

export const pageCounter = (onLoaded: (count: number) => void): HookExtension => ({
  key: 'myApp.pageCounter',
  options: true, // its hookOptions value, which turns it on
  onEvent: (event) => {
    if (event.name !== 'myApp.pageCounter.pageLoaded') return;
    onLoaded((event as PageLoaded).payload.count);
  },
});
```

### 6. Use it

Pass the extension to [`useExtensions`][useExtensions] and spread the result onto the WebView:

```tsx
import { useRef, useState } from 'react';
import { Button } from 'react-native';
import { WebView, useExtensions, type WebViewRef } from 'react-native-minimal-webview';

import { pageCounter } from '../modules/page-counter';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const [count, setCount] = useState(0);
  const hooks = useExtensions([pageCounter(setCount)]);
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
        {...hooks}
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
| `context.emit(name, payload)` | The extension's `onEvent` gets `<key>.<name>` |
| `context.ask(name, payload, onAnswer)` | `onEvent`'s return value, a promise awaited, is the answer |
| `context.handle(method, handler)` | [`ref.hook(key, method, args)`][hook] resolves with the reply |
| `context.options`, `context.onOptionsChange` | The extension's `options`; a change arrives live |

## Share the WebView with the core

The core keeps the WebView's own delegate and client slots. Your hook adds to the context's lists instead:

- A callback the core also handles reaches the core first, then each hook that implements it.
- A decision, such as whether a navigation loads or a page gets the camera, goes to the first hook that implements it.
- On iOS, an auth challenge goes to each hook in turn, until one answers.
- A hook that takes a decision switches off the props that make it, such as `navigationRules` or
  `onPermissionRequest`. A warning in the console names what stopped applying.

Leave alone what the core owns, listed at the top of [`Hooks.swift`][swift] and [`Hooks.kt`][kotlin]. The full routing
rules are on `navigationDelegates` and `clients` there, and `ask`'s answers on `ask`.

## Lifecycle

| When | What the hook gets |
|---|---|
| A WebView with its key mounts | Android: the `webViewFactory`, if it has one. Then `configure`, if it has one, then `attach` |
| The page ends: a navigation commits, a crash, or unmount | Its `onDocumentEnd` handlers run. Reset per-page state there. |
| Its `hookOptions` value changes | Its `onOptionsChange` handlers run, without a reload |
| Its key turns on after mount | `attach` runs then, unless the hook has `configure` or its own WebView class |
| Its key is removed | `onOptionsChange` with null. It stays attached. |
| The renderer crashes | iOS keeps the `WKWebView` and reloads it, unless the crash guard holds it back; nothing attaches again. Android destroys the `WebView` (the closure `attach` returned, then `onDestroyed` with `CRASHED`), then the factory, `configure` and `attach` run again, on a new context. |
| The WebView unmounts | `onDocumentEnd` with `closing`, then the closure `attach` returned, then on Android `onDestroyed` with `CLOSING` |

`DocumentScope` ([Swift][documentscope], [Kotlin][documentscopekt]) says exactly when a page ends.

## Rules

- Register in `OnCreate`, under a key prefixed with your package's name: `register` in [`Hooks.swift`][swift] and
  [`Hooks.kt`][kotlin] has the rules.
- Use the context on the main thread. `emit` and `ask` work from any thread.
- On iOS, hold the context weakly from what its handlers capture, or neither is freed.

## Platform differences

| | iOS | Android |
|---|---|---|
| Callbacks go in | `navigationDelegates`, `uiDelegates` | `clients`, `chromeClients`, `touchListeners`, `scrollListeners` |
| `configure` gets | The `WKWebViewConfiguration`, before the view exists | The new `WebView`, before the core sets it up |
| Your own WebView class | `webViewClass:` | `webViewFactory =` |
| Only on this platform | `refreshControl` | `onDownloadStart`, `onDestroyed` |

## Reference

- Native API: [`Hooks.swift`][swift] and [`Hooks.kt`][kotlin], with `MinimalWebViewHooks` and `WebViewContext`.
- JS API: [`useExtensions`][useExtensions], [`HookExtension`][HookExtension], [`hookOptions`][hookOptions] and
  [`ref.hook`][hook].
- [sample-extension][sample]: a hook for each seam the core offers, run by the example app's tests.
- [@react-native-minimal-webview/extensions][extensions]: ready-made hooks. Its README shows how to copy one into your
  own module.

[extensions]: https://rasmuskard.github.io/react-native-minimal-webview/extensions/
[sample]: https://github.com/RasmusKard/react-native-minimal-webview/tree/main/example/modules/sample-extension
[swift]: https://github.com/RasmusKard/react-native-minimal-webview/blob/main/ios/Hooks.swift
[kotlin]: https://github.com/RasmusKard/react-native-minimal-webview/blob/main/android/src/main/java/expo/modules/minimalwebview/Hooks.kt
[documentscope]: https://github.com/RasmusKard/react-native-minimal-webview/blob/main/ios/DocumentScope.swift
[documentscopekt]: https://github.com/RasmusKard/react-native-minimal-webview/blob/main/android/src/main/java/expo/modules/minimalwebview/DocumentScope.kt
[HookExtension]: https://rasmuskard.github.io/react-native-minimal-webview/types/HookExtension.html
[useExtensions]: https://rasmuskard.github.io/react-native-minimal-webview/functions/useExtensions.html
[hookOptions]: https://rasmuskard.github.io/react-native-minimal-webview/interfaces/WebViewProps.html#hookoptions
[hook]: https://rasmuskard.github.io/react-native-minimal-webview/types/WebViewRef.html#hook
