# @minimal-rn-webview/extensions

react-native-webview props for [minimal-rn-webview](https://github.com/RasmusKard/minimal-rn-webview), each brought back
by a native hook of its own.

## Setup

It has the core's [requirements](https://github.com/RasmusKard/minimal-rn-webview#readme). Install both, then rebuild
the app, since the package has native code:

```sh
npx expo install minimal-rn-webview @minimal-rn-webview/extensions
```

Each extension is a function whose result goes to the core's
[`useExtensions`](https://rasmuskard.github.io/minimal-rn-webview/functions/useExtensions.html):

```tsx
import { basicAuthCredential, onScroll } from '@minimal-rn-webview/extensions';
import { WebView, useExtensions } from 'minimal-rn-webview';

const hooks = useExtensions([
  basicAuthCredential({ username: 'user', password: 'secret' }),
  onScroll(({ nativeEvent }) => console.log(nativeEvent.contentOffset.y)),
]);
<WebView source={{ uri: 'https://example.com' }} {...hooks} />;
```

## Extensions

| Function | Platforms | Folder |
|---|---|---|
| [`basicAuthCredential(credential)`](https://rasmuskard.github.io/minimal-rn-webview/extensions/functions/basicAuthCredential.html) | iOS, Android | `basicAuthCredential` |
| [`dialogs(onDialog)`](https://rasmuskard.github.io/minimal-rn-webview/extensions/functions/dialogs.html) | iOS, Android | `dialogs` |
| [`menuItems({ items, suppress, onSelect })`](https://rasmuskard.github.io/minimal-rn-webview/extensions/functions/menuItems.html) | iOS, Android (`suppress`: iOS) | `menuItems` |
| [`onScroll(handler)`](https://rasmuskard.github.io/minimal-rn-webview/extensions/functions/onScroll.html) | iOS, Android | `onScroll` |
| [`hideKeyboardAccessoryView()`](https://rasmuskard.github.io/minimal-rn-webview/extensions/functions/hideKeyboardAccessoryView.html) | iOS | `hideKeyboardAccessoryView` |
| [`nestedScrollEnabled()`](https://rasmuskard.github.io/minimal-rn-webview/extensions/functions/nestedScrollEnabled.html) | Android | `nestedScrollEnabled` |
| [`androidLayerType(type)`](https://rasmuskard.github.io/minimal-rn-webview/extensions/functions/androidLayerType.html) | Android | `androidLayerType` |

The folder holds the extension's Swift, Kotlin and TS. The [API reference](https://rasmuskard.github.io/minimal-rn-webview/extensions/)
has the rest.

## Vendoring an extension

To change an extension, or to take only one, copy it into a module of your own:

1. `npx create-expo-module --local <name>`.
2. Copy the extension's folder into it: the `.swift` file into `ios/`, the `.kt` file next to your module's
   `<Name>Module.kt` (in `android/src/main/java/`), and `index.ts`, the function that returns its `HookExtension`, into
   `src/`, and export that function from your module's `index.ts`.
3. In the `.kt` file, change the `package` line to the one in your `<Name>Module.kt`.
4. Register the hook: in both `<Name>Module.swift` and `<Name>Module.kt`, add
   `OnCreate { BasicAuthCredential.register() }` (the extension's own name) to the module's `definition()`. The copies
   are in your module and its package, so they need no import.
5. Add the core as a dependency: `s.dependency 'MinimalWebView'` in the podspec, and
   `implementation project(':minimal-rn-webview')` in `android/build.gradle`.
6. Prefix the hook key with your own name, in the Swift, the Kotlin and the TS.
7. Rebuild the app.

The Swift keeps its type names: they belong to your module. A changed `hideKeyboardAccessoryView` needs a `suffix` of
its own too, since the runtime class it makes is found by that name.

While this package is installed too, a `package` line you forgot to change fails the Android build with a duplicate
class, and a key you forgot to rename fails at launch with "two hooks are registered under …: prefix yours with your
package's name".
