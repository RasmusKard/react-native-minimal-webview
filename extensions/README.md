# @react-native-minimal-webview/extensions

<!-- #region intro -->

Native hooks for [react-native-minimal-webview](https://github.com/RasmusKard/react-native-minimal-webview) that bring
back react-native-webview props, such as `onScroll` and `basicAuthCredential`, and add JS-answered dialogs.
<!-- #endregion intro -->

## Setup

<!-- #region setup -->

It has the same [requirements](https://github.com/RasmusKard/react-native-minimal-webview#requirements) as
react-native-minimal-webview. Install the two packages together, then rebuild the app, since this package has native
code:

```sh
npx expo install react-native-minimal-webview @react-native-minimal-webview/extensions
```

Each extension is a function whose result goes into the
[`extensions`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#extensions) prop of `<WebView>`:

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
        onScroll(({ contentOffset }) => console.log(contentOffset.y)),
      ]}
    />
  );
}
```

<!-- #endregion setup -->

## Extensions

| Function                                                                                                                                                                      | Platforms                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`basicAuthCredential(credential)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/basicAuthCredential/)                           | iOS, Android                   |
| [`dialogs(onDialog)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/dialogs/)                                                     | iOS, Android                   |
| [`incognito()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/incognito/)                                                         | iOS, Android                   |
| [`menuItems({ items, suppress, onSelect })`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/menuItems/)                            | iOS, Android (`suppress`: iOS) |
| [`onScroll(handler)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/onScroll/)                                                    | iOS, Android                   |
| [`transparentBackground()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/transparentBackground/)                                 | iOS, Android                   |
| [`hideKeyboardAccessoryView()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/hideKeyboardAccessoryView/)                         | iOS                            |
| [`keyboardDisplayRequiresUserAction(required)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/keyboardDisplayRequiresUserAction/) | iOS                            |
| [`refreshControlLightMode()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/refreshControlLightMode/)                             | iOS                            |
| [`removeIosKeyboardObserver()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/removeIosKeyboardObserver/)                         | iOS                            |
| [`nestedScrollEnabled()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/nestedScrollEnabled/)                                     | Android                        |
| [`androidLayerType(type)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/androidLayerType/)                                       | Android                        |
| [`downloadManager({ downloadingMessage })`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/downloadManager/)                       | Android                        |
| [`onLoadSubResourceError(handler)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/onLoadSubResourceError/)                        | Android                        |

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
4. Register the hook, for each platform the extension has:
   - Call `<Extension>.register()`, such as `BasicAuthCredential.register()`, in the `OnCreate` block of `<Name>Module.swift` and of `<Name>Module.kt`. Add one to `definition()` if it has none.
   - Keep to one `OnCreate`: on Android a second one replaces the first.
   - The copies share your module's package, so they need no import.
5. In the hook key, replace the `@react-native-minimal-webview/extensions` prefix with your package's name, in the
   Swift, the Kotlin and the TS.
6. Rebuild the app.

The Swift keeps its type names: they belong to your module.

### Steps for particular extensions

- `downloadManager` and `incognito`: copy the extensions' `src/Cookies.kt` next to the extension's `.kt` file, and change its `package` line too.

### If you miss a step

With this package installed as well:

- A `package` line you forgot to change fails the Android build with a duplicate class.
- A key you forgot to rename registers two hooks under one key. What happens is in `register` of the hooks API for
  [iOS](https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/minimalwebviewhooks/) and
  [Android](https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-minimal-web-view-hooks/).
