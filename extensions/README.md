# @react-native-minimal-webview/extensions

<!-- #region intro -->

Native hooks for [react-native-minimal-webview](https://github.com/RasmusKard/react-native-minimal-webview). They bring
back react-native-webview props, such as `onScroll` and `basicAuthCredential`, and let your JS answer the page's
dialogs.
<!-- #endregion intro -->

## Setup

<!-- #region setup -->

This package has the same [requirements](https://github.com/RasmusKard/react-native-minimal-webview#requirements) as
react-native-minimal-webview. Install the two packages together, then rebuild the app:

```sh
npx expo install react-native-minimal-webview @react-native-minimal-webview/extensions
```

Each extension is a function whose result goes into the
[`extensions`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#extensions) prop of `<WebView>`:

```tsx
import { basicAuthCredential, onScroll } from '@react-native-minimal-webview/extensions';
import { useState } from 'react';
import { Text } from 'react-native';
import { WebView } from 'react-native-minimal-webview';

export function Staging() {
  const [atTop, setAtTop] = useState(true);
  return (
    <>
      {atTop && <Text>Staging</Text>}
      <WebView
        source={{ uri: 'https://staging.example.com' }}
        style={{ flex: 1 }}
        extensions={[
          // The staging site sits behind HTTP basic auth
          basicAuthCredential({ username: 'tester', password: 'secret' }),
          // Show the app's header only while the page is at its top
          onScroll(({ contentOffset }) => setAtTop(contentOffset.y <= 0)),
        ]}
      />
    </>
  );
}
```

<!-- #endregion setup -->

## Extensions

| Function                                                                                                                                                                      | Platforms                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`basicAuthCredential(credential)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/basicAuthCredential/)                           | iOS, Android                   |
| [`dialogs(onDialog)`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/dialogs/)                                                     | iOS, Android                   |
| [`googleMobileAds()`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/extensions/functions/googleMobileAds/)                                             | iOS, Android                   |
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
behavior and limits. Each function's code is in the folder named after it. The folder has the TS, and the Swift or
Kotlin for each platform the function supports.

## Vendoring an extension

To change an extension, or to take only one, copy it into a module of your own:

1. Create the module, with the core as its dependency and iOS 17.0 as its platform. Steps 1 and 2 of
   [Native hooks](https://rasmuskard.github.io/react-native-minimal-webview/guides/native-hooks/#1-create-a-module)
   show how.
2. Copy the extension's files into it:
   - the `.swift` file into `ios/`
   - the `.kt` file next to your module's `<Name>Module.kt`, in `android/src/main/java/`
   - `index.ts`, the function that returns its `HookExtension`, into `src/` under the extension's name (such as
     `src/basicAuthCredential.ts`), and export it from your module's `index.ts`
3. In the `.kt` file, change the `package` line to the one in your `<Name>Module.kt`.
4. Register the hook, for each platform the extension has:
   - Call `<Extension>.register()`, such as `BasicAuthCredential.register()`, in the `OnCreate` block of `<Name>Module.swift` and of `<Name>Module.kt`. Add an `OnCreate` block to `definition()` if it has none.
   - Keep to one `OnCreate` block. On Android, a second one replaces the first.
5. In the hook key, replace the `@react-native-minimal-webview/extensions` prefix with your package's name, in the
   Swift, the Kotlin and the TS.
6. Rebuild the app.

The Swift types keep their names, because they belong to your module.

### Steps for particular extensions

- For `downloadManager` and `incognito`, copy the extensions' `src/Cookies.kt` next to the extension's `.kt` file, and change its `package` line too.
- For `googleMobileAds`, copy the rules in the extensions' `consumer-rules.pro` into your module's consumer ProGuard
  rules. That is the file that `consumerProguardFiles` names in your module's `android/build.gradle`.

### If you miss a step

If this package is installed as well, a missed step shows up like this:

- A `package` line you forgot to change fails the Android build with a duplicate class.
- A key you forgot to rename registers two hooks under one key. What happens is in `register` of the hooks API for
  [iOS](https://rasmuskard.github.io/react-native-minimal-webview/swift/documentation/minimalwebview/minimalwebviewhooks/) and
  [Android](https://rasmuskard.github.io/react-native-minimal-webview/kotlin/react-native-minimal-webview/expo.modules.minimalwebview/-minimal-web-view-hooks/).
