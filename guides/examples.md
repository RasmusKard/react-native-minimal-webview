---
title: Examples
---

# Examples

Examples of the main interfaces. What each prop, method and type does is in its TSDoc, generated into the
[API reference](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/).

## Navigation state

Show the URL, progress or a back button, and go back on Android's back button.

```tsx
import { useEffect, useRef } from 'react';
import { BackHandler, Button } from 'react-native';
import { WebView, useWebViewState, type WebViewRef } from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  // Only canGoBack: Browser doesn't re-render as a page loads
  const canGoBack = useWebViewState(ref, (state) => state.canGoBack);

  // Android's back button is the app's to handle
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
      <Button title="Back" disabled={!canGoBack} onPress={() => ref.current?.goBack()} />
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

// A push notification handler, say
function onInboxNotification() {
  if (webView.getState().url.startsWith('https://example.com/inbox')) webView.current?.reload();
}

<WebView ref={webView} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
```

## Loading and error screens

Draw a spinner and your own error screen over the WebView, from the navigation state and `onError`.

```tsx
import { useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import {
  WebView,
  useWebViewState,
  type LoadErrorEvent,
  type WebViewRef,
} from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const loading = useWebViewState(ref, (state) => state.loading);
  const [error, setError] = useState<LoadErrorEvent | null>(null);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={ref}
        source={{ uri: 'https://example.com' }}
        onError={(e) => e.kind !== 'http' && setError(e)} // on 'http' the site's own error page shows
        onLoadStart={() => setError(null)}
        style={{ flex: 1 }}
      />
      {error ? (
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

Keep the WebView on your sites and open the rest externally, with JS deciding only the URLs that need it. Form POSTs,
an iframe's to the main frame included, skip the rules:
[`navigationRules`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/interfaces/WebViewProps/#navigationrules)
says where they load.

```tsx
import { WebView, defaultNavigationRules } from 'react-native-minimal-webview';

export function Site() {
  return (
    <WebView
      source={{ uri: 'https://example.com' }}
      style={{ flex: 1 }}
      navigationRules={[
        { host: ['pay.example.com'], action: 'ask' }, // onNavigationRequest decides
        { host: ['example.com', '*.example.com'], action: 'allow' },
        { scheme: ['http', 'https'], mainFrame: false, action: 'allow' }, // embedded content stays in the page
        { scheme: ['tel', 'mailto'], action: 'external' }, // also from an iframe
        { scheme: ['http', 'https'], action: 'external' }, // other sites, and new windows
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
  // Once: a new bridge recreates the WebView
  const bridge = useMemo(
    () => createBridge<ShopBridge>({ allowedOrigins: ['https://example.com'] }),
    []
  );

  // handle returns the unsubscribe, which is the cleanup
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
// A module script, for the top-level await
const cart = [];
window.nativeBridge.handle('getCartCount', () => cart.length);
window.nativeBridge.on('themeChanged', (theme) => {
  document.documentElement.dataset.theme = theme;
});

const shared = await window.nativeBridge.call('share', { url: location.href }, { timeoutMs: 0 }); // the share sheet waits on the user
```

Opened in a browser, or from an origin the bridge doesn't allow, the page has no `window.nativeBridge`: the TypeScript
sample below guards for it.

An event reaches only the page that is open when it is sent. A page that needs the current value, such as the theme,
asks for it with a `call` as it loads, and listens for the changes.

A TypeScript page types `window.nativeBridge` with
[`PageBridge`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/PageBridge/),
a type-only import: the page's project needs the package as a dev dependency, and must share or copy the schema type.

```ts
// A module script, for the top-level await
import type { PageBridge } from 'react-native-minimal-webview';

type ShopBridge = {
  reactNative: { share: { params: { url: string }; result: boolean } };
  page: { getCartCount: { result: number } };
  events: { themeChanged: 'light' | 'dark' };
};

declare global {
  interface Window {
    nativeBridge?: PageBridge<ShopBridge>; // only in the app, on an allowed origin
  }
}

const cart: string[] = [];
window.nativeBridge?.handle('getCartCount', () => cart.length);
const shared = await window.nativeBridge?.call('share', { url: location.href }, { timeoutMs: 0 });
```

## Platform settings

Any setting by its platform name, and any public method through `call`. [Use a platform API](platform-apis.md) shows
how to find a key or a `call` string in Apple's and Android's documentation.

```tsx
import { AndroidConstants, IOSConstants, WebView } from 'react-native-minimal-webview';

<WebView
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  ios={{
    configuration: { dataDetectorTypes: IOSConstants.DataDetectorTypes.link }, // WKWebViewConfiguration: a new value recreates the WebView
    preferences: { minimumFontSize: 12 }, // WKPreferences
    webpagePreferences: { allowsContentJavaScript: false }, // WKWebpagePreferences
    webView: { allowsBackForwardNavigationGestures: true }, // WKWebView
    scrollView: { bounces: false }, // its UIScrollView
  }}
  android={{
    settings: { textZoom: 120, cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE }, // WebSettings
    webView: { overScrollMode: 2, verticalScrollBarEnabled: false }, // WebView
  }}
/>;
```

### Reading and calling

`get` reads a property and `call` calls a method, on a mounted WebView's ref.

```ts
import { IOSConstants, createWebViewRef } from 'react-native-minimal-webview';

const ref = createWebViewRef(); // pass it as the `<WebView ref={ref}>`

const bounces = await ref.current?.get('scrollView.bounces'); // iOS; 'settings.textZoom' on Android

// Android: a public method of settings, webView, cookieManager or webStorage
await ref.current?.call('webStorage.deleteAllData');
await ref.current?.call('cookieManager.removeAllCookies');

// iOS: an Objective-C selector
await ref.current?.call('websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:', [
  { set: [IOSConstants.WebsiteDataType.cookies, IOSConstants.WebsiteDataType.localStorage] },
  { date: 0 },
]);
const png = await ref.current?.call('webView.takeSnapshotWithConfiguration:completionHandler:', [
  null,
]); // base64
```

## Cookies

Set the session cookie, or read the WebView's cookies. Cookies go through `call`, as in [Reading and calling](#reading-and-calling).

```ts
import { createWebViewRef } from 'react-native-minimal-webview';

const ref = createWebViewRef(); // pass it as the `<WebView ref={ref}>`
const token = 'SESSION_TOKEN'; // your session's value

// iOS: the WebView's data store (`sharedCookies` syncs it with the app's)
await ref.current?.call('httpCookieStore.setCookie:completionHandler:', [
  { cookie: { Name: 'session', Value: token, Domain: 'example.com', Path: '/', Secure: 'TRUE' } },
]);
const cookies = await ref.current?.call('httpCookieStore.getAllCookies:'); // [{ Name, Value, Domain, Path, … }]

// Android: the CookieManager of the WebView's profile, the app-wide one by default
await ref.current?.call('cookieManager.setCookie', [
  'https://example.com',
  `session=${token}; Secure`,
]);
const header = await ref.current?.call('cookieManager.getCookie', ['https://example.com']); // 'session=…; other=…'
```

### Before the first page

The calls need a mounted WebView. Mount it with `{ uri: 'about:blank' }`, and set the real `source` once the cookie is
set.

## Scripts

Run a script in every page before the page's own scripts and before its DOM exists, or evaluate one in the page that
is open.

```tsx
import { WebView, createWebViewRef } from 'react-native-minimal-webview';

const ref = createWebViewRef();
const config = { apiUrl: 'https://api.example.com' };

<WebView
  ref={ref}
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  injectedScripts={[
    { code: `window.config = ${JSON.stringify(config)}`, origins: ['https://example.com'] },
  ]}
/>;

const title = await ref.current?.evaluate('document.title'); // an expression, not statements
await ref.current?.evaluate(`(() => { document.body.style.background = 'red'; })()`);
```

## Local files

An HTML string loads with `html`, its relative URLs resolved against `baseUrl`. A bundled file loads from its `file://`
URI, such as expo-asset's `localUri`. [`WebViewSource`](https://rasmuskard.github.io/react-native-minimal-webview/typescript/react-native-minimal-webview/type-aliases/WebViewSource/) has each
platform's file access.

```tsx
import { useAssets } from 'expo-asset';
import { WebView } from 'react-native-minimal-webview';

export function LocalPages() {
  const [assets] = useAssets(require('./page.html'));
  return (
    <>
      <WebView
        source={{ html: '<img src="logo.png">', baseUrl: 'https://example.com' }}
        style={{ flex: 1 }}
      />
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

## Page requests

Answer what the page asks the app for: files, the camera or microphone, fullscreen and downloads.

### File inputs

Answer an `<input type="file">` with a document picker or the camera.

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

// Asks the OS for what the page wants; a resource this app doesn't give has no entry
const askOS: Partial<Record<PermissionResource, () => Promise<{ granted: boolean }>>> = {
  camera: Camera.requestCameraPermissionsAsync,
  microphone: Camera.requestMicrophonePermissionsAsync,
};

<WebView
  source={{ uri: 'https://meet.example.com' }}
  style={{ flex: 1 }}
  onPermissionRequest={async ({ origin, resources }) => {
    if (origin !== 'https://meet.example.com') return false;
    for (const resource of resources) {
      if (!(await askOS[resource]?.())?.granted) return false; // a video call asks for both at once
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

`preview()` needs expo-file-system 58 (Expo SDK 58) or later.

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

```tsx
import { AndroidWebView, WebView } from 'react-native-minimal-webview';

// An internal release build that testers debug
AndroidWebView.setWebContentsDebuggingEnabled(true); // every WebView in the app

<WebView
  source={{ uri: 'https://example.com' }}
  style={{ flex: 1 }}
  ios={{ webView: { inspectable: true } }}
/>;
```

## Native hooks

The [native hooks guide](native-hooks.md) builds one, from module to the `extensions` prop.
