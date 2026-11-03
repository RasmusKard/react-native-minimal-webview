# @react-native-minimal-webview/extensions

Native hooks for [react-native-minimal-webview](https://github.com/RasmusKard/react-native-minimal-webview) that bring
back react-native-webview props, such as `onScroll` and `basicAuthCredential`, and add JS-answered dialogs.

## Setup

It has the core's [requirements](https://github.com/RasmusKard/react-native-minimal-webview#requirements). Install both, then
rebuild the app, since the package has native code:

```sh
npx expo install react-native-minimal-webview @react-native-minimal-webview/extensions
```

Each extension is a function whose result goes into the core's
[`extensions`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#extensions) prop:

```tsx
import { basicAuthCredential, onScroll } from '@react-native-minimal-webview/extensions';
import { WebView } from 'react-native-minimal-webview';

export function Browser() {
  return (
    <WebView
      source={{ uri: 'https://example.com' }}
      style={{ flex: 1 }}
      extensions={[
        basicAuthCredential({ username: 'user', password: 'secret' }),
        onScroll(({ nativeEvent }) => console.log(nativeEvent.contentOffset.y)),
      ]}
    />
  );
}
```

## Extensions

| Function | Platforms |
|---|---|
| [`basicAuthCredential(credential)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/basicAuthCredential/) | iOS, Android |
| [`dialogs(onDialog)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/dialogs/) | iOS, Android |
| [`menuItems({ items, suppress, onSelect })`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/menuItems/) | iOS, Android (`suppress`: iOS) |
| [`onScroll(handler)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/onScroll/) | iOS, Android |
| [`hideKeyboardAccessoryView()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/hideKeyboardAccessoryView/) | iOS |
| [`nestedScrollEnabled()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/nestedScrollEnabled/) | Android |
| [`androidLayerType(type)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/androidLayerType/) | Android |

Each function's [API reference](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/) page has its
behavior and limits. Its code is in the folder named after it: the TS, and the Swift or Kotlin for each platform it has.

## Vendoring an extension

To change an extension, or to take only one, copy it into a module of your own:

1. Create the module, with the core as its dependency and iOS 17.0 as its platform: steps 1 and 2 of
   [Native hooks](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/#1-create-a-module).
2. Copy the extension's files into it:
   - the `.swift` file into `ios/`
   - the `.kt` file next to your module's `<Name>Module.kt`, in `android/src/main/java/`
   - `index.ts`, the function that returns its `HookExtension`, into `src/` under the extension's name (such as
     `src/basicAuthCredential.ts`), and export it from your module's `index.ts`
3. In the `.kt` file, change the `package` line to the one in your `<Name>Module.kt`.
4. Register the hook in `<Name>Module.swift` and `<Name>Module.kt`, for each platform the extension has: call
   `BasicAuthCredential.register()`, with the extension's own name, inside the module's one `OnCreate` block (add one
   to `definition()` if it has none; on Android a second `OnCreate` replaces the first). The copies are in your module and its package, so they need no import.
5. In the hook key, replace the `@react-native-minimal-webview/extensions` prefix with your package's name, in the
   Swift, the Kotlin and the TS.
6. Rebuild the app.

The Swift keeps its type names: they belong to your module.

A changed `hideKeyboardAccessoryView` also needs a `suffix` of its own: the runtime class it makes is found by that
name.

With this package installed as well, a `package` line you forgot to change fails the Android build with a duplicate
class. A key you forgot to rename registers two hooks under one key: `register`, in the
[iOS](https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/minimalwebviewhooks/) and
[Android](https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-minimal-web-view-hooks/)
hooks API, says what happens.
