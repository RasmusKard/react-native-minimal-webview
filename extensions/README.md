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
2. Copy the extension's folder into it: the `.swift` file into `ios/`, the `.kt` file into `android/src/main/java/`, and
   `index.ts`, the function that returns its `HookExtension`, into `src/`. Call its `register()` from your module's
   `OnCreate`.
3. Add the core as a dependency: `s.dependency 'MinimalWebView'` in the podspec, and
   `implementation project(':minimal-rn-webview')` in `android/build.gradle`.
4. Prefix the hook key with your own name, in the Swift, the Kotlin and the TS.
5. Rebuild the app.

While this package is installed too, a key you forgot to rename fails at launch with "two hooks are registered under …:
prefix yours with your package's name".
