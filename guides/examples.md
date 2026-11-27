# Examples

These examples show the main interfaces in use. The
[API reference](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/) says what each prop, method and type does.

## Navigation state

Show the page's title and back and forward buttons, and go back on Android's back button.

```tsx
import { useEffect, useRef } from 'react';
import { BackHandler, Button, Text } from 'react-native';
import { WebView, useWebViewState, type WebViewRef } from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  // One field per selector, so Browser doesn't re-render on each progress change
  const title = useWebViewState(ref, (state) => state.title);
  const canGoBack = useWebViewState(ref, (state) => state.canGoBack);
  const canGoForward = useWebViewState(ref, (state) => state.canGoForward);

  // The WebView doesn't handle Android's back button
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      ref.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  return (
    <>
      <Text>{title}</Text>
      <Button title="Back" disabled={!canGoBack} onPress={() => ref.current?.goBack()} />
      <Button title="Forward" disabled={!canGoForward} onPress={() => ref.current?.goForward()} />
      <WebView ref={ref} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />
    </>
  );
}
```

### Outside React

Read the state and call the WebView from code outside a component.

```tsx
import { WebView, createWebViewRef } from 'react-native-minimal-webview';

export const webView = createWebViewRef();

// For example, a push notification handler
function onInboxNotification() {
  if (webView.getState().url.startsWith('https://example.com/inbox')) webView.current?.reload();
}

<WebView ref={webView} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
```

## Loading and error screens

Draw a spinner and your own error screen over the WebView, from the navigation state, `onError` and `onProcessGone`.

```tsx
import { useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { WebView, useWebViewState, type WebViewRef } from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const loading = useWebViewState(ref, (state) => state.loading);
  const [failed, setFailed] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={ref}
        source={{ uri: 'https://example.com' }}
        onError={(e) => e.kind !== 'http' && setFailed(true)} // an 'http' error shows the site's own page
        // When the core doesn't reload the page after a crash, the user retries
        onProcessGone={(e) => !e.recovered && setFailed(true)}
        onLoadStart={() => setFailed(false)}
        style={{ flex: 1 }}
      />
      {failed ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text>Could not load the page</Text>
          <Button title="Retry" onPress={() => ref.current?.reload()} />
        </View>
      ) : loading ? (
        <ActivityIndicator style={StyleSheet.absoluteFill} />
      ) : null}
    </View>
  );
}
```

## Navigation rules

Keep the WebView on your sites, open other sites externally, and let JS decide only the URLs that need it. Some
navigations, such as a form POST, skip the rules.
[`navigationRules`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules)
lists them.

```tsx
import { WebView, defaultNavigationRules } from 'react-native-minimal-webview';

export function Site() {
  return (
    <WebView
      source={{ uri: 'https://example.com' }}
      style={{ flex: 1 }}
      navigationRules={[
        { query: ['external', 'view=browser'], action: 'external' },
        { host: ['pay.example.com'], action: 'ask' }, // onNavigationRequest decides
        { host: ['example.com', '*.example.com'], action: 'allow' },
        { scheme: ['http', 'https'], mainFrame: false, action: 'allow' }, // embedded content stays in the page
        { scheme: ['tel', 'mailto'], action: 'external' }, // also from an iframe
        { scheme: ['http', 'https'], action: 'external' }, // other sites, new windows included
        ...defaultNavigationRules, // file: blocked, other schemes external from a user gesture
      ]}
      onNavigationRequest={({ url }) =>
        url.startsWith('https://pay.example.com/checkout') ? 'allow' : 'block'
      }
      onNavigation={({ url, action, rule }) => console.log(action, url, rule)}
    />
  );
}
```

## The bridge

Call the page from the app, and the app from the page, with typed methods and events.

```tsx
import { useEffect, useMemo } from 'react';
import { Button, Platform, Share } from 'react-native';
import { WebView, createBridge } from 'react-native-minimal-webview';

type ShopBridge = {
  reactNative: { share: { params: { url: string }; result: boolean } }; // handled in React Native
  page: { getCartCount: { result: number } }; // handled by the page
  events: { themeChanged: 'light' | 'dark' };
};

export function Shop() {
  // Made once, because a new bridge recreates the WebView
  const bridge = useMemo(
    () => createBridge<ShopBridge>({ allowedOrigins: ['https://example.com'] }),
    []
  );

  // handle returns its unsubscribe function, which is the effect's cleanup
  useEffect(
    () =>
      bridge.handle('share', async ({ url }) => {
        const { action } = await Share.share(Platform.OS === 'ios' ? { url } : { message: url });
        return action === Share.sharedAction;
      }),
    [bridge]
  );

  return (
    <>
      <Button title="Dark" onPress={() => bridge.emit('themeChanged', 'dark')} />
      <Button title="Cart" onPress={async () => console.log(await bridge.call('getCartCount'))} />
      <WebView bridge={bridge} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />
    </>
  );
}
```

### In the page

A page on an allowed origin has the same four methods on `window.nativeBridge`, as
[`Bridge`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/Bridge/) describes.

```js
// A module script, so that top-level await works
const cart = [];
// A browser, or an origin the bridge doesn't allow, has no window.nativeBridge
window.nativeBridge?.handle('getCartCount', () => cart.length);
window.nativeBridge?.on('themeChanged', (theme) => {
  document.documentElement.dataset.theme = theme;
});

const shared = await window.nativeBridge?.call('share', { url: location.href }, { timeoutMs: 0 }); // no timeout: the share sheet waits for the user
```

An event isn't repeated for a page that loads later. A page that needs the current value, such as the theme, asks for
it with a `call` as it loads and then listens for changes.

A TypeScript page types `window.nativeBridge` with
[`PageBridge`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/PageBridge/)
and the app's schema, imported or copied:

```ts
import type { PageBridge } from 'react-native-minimal-webview';

type ShopBridge = {
  reactNative: { share: { params: { url: string }; result: boolean } };
  page: { getCartCount: { result: number } };
  events: { themeChanged: 'light' | 'dark' };
};

declare global {
  interface Window {
    nativeBridge?: PageBridge<ShopBridge>;
  }
}
```

## Platform settings

[Use a platform API](platform-apis.md) shows how to write any setting by its platform name.

### Reading and calling

On a mounted WebView's ref, `get` reads a platform property and `call` calls a platform method.

```ts
import { IOSConstants, createWebViewRef } from 'react-native-minimal-webview';

const ref = createWebViewRef(); // pass it as the `<WebView ref={ref}>`

// Android: the WebView's user agent, to send the same one from your own requests
const userAgent = await ref.current?.get('settings.userAgentString');

// Log out on Android: clear the cookies and the pages' storage
await ref.current?.call('webStorage.deleteAllData');
await ref.current?.call('cookieManager.removeAllCookies');

// Log out on iOS
await ref.current?.call('websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:', [
  { set: [IOSConstants.WebsiteDataType.cookies, IOSConstants.WebsiteDataType.localStorage] },
  { date: 0 },
]);
// iOS: a screenshot of the page, for a tab switcher's thumbnail
const png = await ref.current?.call('webView.takeSnapshotWithConfiguration:completionHandler:', [
  null,
]); // base64
```

## Cookies

Set the session cookie, or read the WebView's cookies.

```ts
import { createWebViewRef } from 'react-native-minimal-webview';

const ref = createWebViewRef(); // pass it as the `<WebView ref={ref}>`
const token = 'SESSION_TOKEN'; // your session's value

// iOS: the WebView's data store, which `sharedCookies` syncs with the app's
await ref.current?.call('httpCookieStore.setCookie:completionHandler:', [
  { cookie: { Name: 'session', Value: token, Domain: 'example.com', Path: '/', Secure: 'TRUE' } },
]);
const cookies = await ref.current?.call('httpCookieStore.getAllCookies:'); // [{ Name, Value, Domain, Path, … }]

// Android: the CookieManager of the WebView's profile
await ref.current?.call('cookieManager.setCookie', [
  'https://example.com',
  `session=${token}; Secure`,
]);
const header = await ref.current?.call('cookieManager.getCookie', ['https://example.com']); // 'session=…; other=…'
```

### Set a cookie before the first page loads

The calls need a mounted WebView. Mount it with `{ uri: 'about:blank' }`, and set the real `source` once the cookie is
set.

## Scripts

Run a script in your origins' pages before the page's own scripts, or evaluate one in the open page.

```tsx
import { WebView, createWebViewRef } from 'react-native-minimal-webview';

const ref = createWebViewRef();
// Values the page's own scripts read as they start, such as whether they run in the app
const config = { inApp: true, apiUrl: 'https://api.example.com' };

<WebView
  ref={ref}
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  injectedScripts={[
    { code: `window.config = ${JSON.stringify(config)}`, origins: ['https://example.com'] },
  ]}
/>;

const title = await ref.current?.evaluate('document.title'); // an expression, not statements
// Wrap statements in a function and call it. This one pauses the videos as the user leaves the screen
await ref.current?.evaluate(
  `(() => { for (const video of document.querySelectorAll('video')) video.pause(); })()`
);
```

## Local files

Load an HTML string with `html`, or a bundled file by its `file://` URI, such as expo-asset's `localUri`. [`WebViewSource`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewSource/) says which file access each platform needs.

```tsx
import { useAssets } from 'expo-asset';
import { WebView } from 'react-native-minimal-webview';

export function LocalPages({ articleHtml }: { articleHtml: string }) {
  const [assets] = useAssets(require('./terms.html')); // a page that has to open offline
  return (
    <>
      {/* An article's HTML from your API. Its <img src="/images/photo.jpg"> loads from baseUrl */}
      <WebView source={{ html: articleHtml, baseUrl: 'https://example.com' }} style={{ flex: 1 }} />
      {assets?.[0]?.localUri && (
        <WebView
          source={{ uri: assets[0].localUri }}
          style={{ flex: 1 }}
          android={{ settings: { allowFileAccess: true } }}
        />
      )}
    </>
  );
}
```

### Load a bundled page folder

expo-asset stores each bundled file under a name of its own, so a page's relative URLs to its stylesheet and images find nothing. Copy the files into one folder at launch and load its `index.html`. Metro bundles `.css` as code, so make it an asset in `metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => ext !== 'css');
config.resolver.assetExts.push('css');

module.exports = config;
```

```tsx
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { WebView } from 'react-native-minimal-webview';

// Each file by its path relative to index.html
const files = {
  'index.html': require('./page/index.html'),
  'style.css': require('./page/style.css'),
  'images/logo.png': require('./page/images/logo.png'),
};

async function copyPage() {
  const dir = new Directory(Paths.cache, 'page');
  if (dir.exists) dir.delete(); // drops the files of an older app version
  dir.create();
  const assets = await Asset.loadAsync(Object.values(files));
  await Promise.all(
    Object.keys(files).map((path, i) => {
      const file = new File(dir, path);
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      return new File(assets[i].localUri!).copy(file);
    })
  );
  return new File(dir, 'index.html').uri;
}

export function BundledPage() {
  const [uri, setUri] = useState<string>();
  useEffect(() => {
    copyPage().then(setUri, console.error);
  }, []);
  return uri ? (
    <WebView
      source={{ uri }}
      style={{ flex: 1 }}
      android={{ settings: { allowFileAccess: true } }}
    />
  ) : null;
}
```

## Page requests

Answer what the page asks the app for: files, the camera or microphone, fullscreen and downloads.

### File inputs

On Android, answer an `<input type="file">` with a document picker or the camera.

```tsx
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { WebView } from 'react-native-minimal-webview';

<WebView
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  onFileRequest={async ({ accept, multiple, capture }) => {
    if (capture) {
      const photo = await ImagePicker.launchCameraAsync();
      return photo.canceled ? null : photo.assets.map((asset) => asset.uri);
    }
    const mimeTypes = accept.filter((type) => type.includes('/'));
    const result = await DocumentPicker.getDocumentAsync({
      type: mimeTypes.length ? mimeTypes : '*/*',
      multiple,
    });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  }}
/>;
```

### Permissions

Give the camera and the microphone to your own site only, once the OS has granted them.

```tsx
import { Camera } from 'expo-camera';
import { WebView, type PermissionResource } from 'react-native-minimal-webview';

// Asks the OS for each resource the page wants. A resource this app doesn't give has no entry
const askOS: Partial<Record<PermissionResource, () => Promise<{ granted: boolean }>>> = {
  camera: Camera.requestCameraPermissionsAsync,
  microphone: Camera.requestMicrophonePermissionsAsync,
};

<WebView
  source={{ uri: 'https://meet.example.com' }}
  style={{ flex: 1 }}
  onPermissionRequest={async ({ origin, resources }) => {
    if (origin !== 'https://meet.example.com') return false;
    // a video call asks for both at once
    for (const resource of resources) {
      if (!(await askOS[resource]?.())?.granted) return false;
    }
    return true;
  }}
/>;
```

### Fullscreen video

On Android, this lets a portrait-locked app rotate while a video is fullscreen.

```tsx
import * as ScreenOrientation from 'expo-screen-orientation';
import { WebView } from 'react-native-minimal-webview';

<WebView
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  onFullscreenChange={({ active }) =>
    active
      ? ScreenOrientation.unlockAsync()
      : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
  }
/>;
```

### Downloads

Open a file the page downloads.

```tsx
import { File } from 'expo-file-system';
import { WebView } from 'react-native-minimal-webview';

<WebView
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  onDownload={(result) =>
    result.ok ? new File(result.uri).preview() : console.warn('download failed', result.kind)
  }
/>;
```

## Debugging the page

Inspect the page's DOM, console and network from a desktop browser.

- iOS: Safari's Develop menu lists the page while
  [`ios.webView.inspectable`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/IOSSettings/#webview)
  is on, as it is in development.
- Android: Chrome's `chrome://inspect` lists it in a debug build, and
  [`AndroidWebView.setWebContentsDebuggingEnabled`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/namespaces/AndroidWebView/functions/setWebContentsDebuggingEnabled/)
  turns it on in any build.
