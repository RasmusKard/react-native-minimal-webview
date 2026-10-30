---
title: Examples
---

# Examples

One example per public interface. What each prop, method and type does is in its TSDoc, generated into the
[API reference](https://rasmuskard.github.io/react-native-minimal-webview/modules.html).

## Navigation state

```tsx
import { useEffect, useRef } from 'react';
import { BackHandler, Button } from 'react-native';
import { WebView, useWebViewState, type WebViewRef } from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const { canGoBack } = useWebViewState(ref);

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

```tsx
import { WebView, createWebViewRef } from 'react-native-minimal-webview';

export const webView = createWebViewRef();

// A push notification handler, say
function onInboxNotification() {
  if (webView.getState().url.startsWith('https://example.com/inbox')) webView.current?.reload();
}

<WebView ref={webView} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
```

## Navigation rules

```tsx
<WebView
  source={{ uri: 'https://example.com' }}
  navigationRules={[
    { scheme: ['file'], action: 'block' },
    { host: ['pay.example.com'], action: 'ask' }, // onNavigationRequest decides
    { host: ['example.com', '*.example.com'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' }, // iframes
    { scheme: ['tel', 'mailto'], action: 'external' }, // also from an iframe
    { mainFrame: true, userInitiated: true, action: 'external' }, // other sites and new windows, from a user gesture; anything else is blocked
  ]}
  onNavigationRequest={({ url }) => (isTrusted(url) ? 'allow' : 'external')}
  onNavigation={({ url, action, rule }) => console.log(action, url, rule)}
/>
```

## The bridge

```tsx
import { useEffect, useMemo } from 'react';
import { Button, Share } from 'react-native';
import { WebView, createBridge } from 'react-native-minimal-webview';

type Methods = {
  share: { params: { url: string }; result: boolean }; // handled in React Native
  getCartCount: { result: number }; // handled by the page
};
type Events = { themeChanged: 'light' | 'dark' };

export function Shop() {
  // Once: a new bridge recreates the WebView
  const bridge = useMemo(
    () => createBridge<Methods, Events>({ allowedOrigins: ['https://example.com'] }),
    []
  );

  // handle returns the unsubscribe, which is the cleanup
  useEffect(
    () =>
      bridge.handle('share', async ({ url }) => {
        const { action } = await Share.share({ url });
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

The page's `window.nativeBridge` is untyped; this declaration types it.

```ts
declare global {
  interface Window {
    nativeBridge?: {
      /** Rejects with an `Error` whose `code` is one of the bridge's error codes. */
      call(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
      handle(method: string, handler: (params: unknown) => unknown): () => void;
      emit(event: string, payload?: unknown): void;
      on(event: string, listener: (payload: unknown) => void): () => void;
    };
  }
}

const shared = await window.nativeBridge?.call('share', { url: location.href }, { timeoutMs: 0 }); // the share sheet waits on the user
window.nativeBridge?.handle('getCartCount', () => cart.length);
window.nativeBridge?.on('themeChanged', (theme) => applyTheme(theme));
```

## Platform settings

Any setting by its platform name, and any public method through `call`.

```tsx
import { AndroidConstants, IOSConstants, WebView } from 'react-native-minimal-webview';

<WebView
  source={{ uri: 'https://example.com' }}
  ios={{
    configuration: { dataDetectorTypes: IOSConstants.DataDetectorTypes.link }, // WKWebViewConfiguration: read once, at creation
    preferences: { minimumFontSize: 12 }, // WKPreferences
    webpagePreferences: { allowsContentJavaScript: false }, // WKWebpagePreferences
    webView: { allowsBackForwardNavigationGestures: true }, // WKWebView
    scrollView: { bounces: false }, // its UIScrollView
  }}
  android={{
    settings: { textZoom: 120, cacheMode: AndroidConstants.WebSettings.LOAD_NO_CACHE }, // WebSettings, then WebSettingsCompat
    webView: { overScrollMode: 2, acceptThirdPartyCookies: true }, // WebView, then WebViewCompat, then CookieManager
  }}
/>;
```

### Reading and calling

`ref` is the WebView's ref, as in [Navigation state](#navigation-state).

```ts
const bounces = await ref.current?.get('scrollView.bounces'); // iOS; 'settings.textZoom' on Android

// Android: a public method of settings, webView, cookieManager or webStorage
await ref.current?.call('webView.clearCache', [true]);
await ref.current?.call('cookieManager.removeAllCookies'); // resolves once they're gone

// iOS: an Objective-C selector
await ref.current?.call('scrollView.setContentOffset:animated:', [{ x: 0, y: 200 }, true]);
await ref.current?.call('websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:', [
  { set: [IOSConstants.WebsiteDataType.cookies, IOSConstants.WebsiteDataType.localStorage] },
  { date: 0 },
]);
const png = await ref.current?.call('webView.takeSnapshotWithConfiguration:completionHandler:', [
  null,
]); // base64
```

## Cookies

Cookies go through `call`, as in [Platform settings](#platform-settings).

```ts
// iOS: the WebView's data store (`sharedCookies` syncs it with the app's)
await ref.current?.call('httpCookieStore.setCookie:completionHandler:', [
  { cookie: { Name: 'session', Value: token, Domain: 'example.com', Path: '/', Secure: 'TRUE' } },
]);
const cookies = await ref.current?.call('httpCookieStore.getAllCookies:'); // [{ Name, Value, Domain, Path, … }]

// Android: the app-wide CookieManager
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

```tsx
<WebView
  source={{ uri: 'https://example.com' }}
  injectedScripts={[
    { code: `window.config = ${JSON.stringify(config)}`, origins: ['https://example.com'] },
  ]}
/>;

const title = await ref.current?.evaluate('document.title'); // an expression, not statements
await ref.current?.evaluate(`(() => { document.body.style.background = 'red'; })()`);
```

## Local files

A bundled file loads from its `file://` URI, such as expo-asset's `localUri`.
[`WebViewSource`](https://rasmuskard.github.io/react-native-minimal-webview/types/WebViewSource.html) has each
platform's file access.

```tsx
import { useAssets } from 'expo-asset';
import { WebView } from 'react-native-minimal-webview';

export function LocalPages() {
  const [assets] = useAssets(require('./page.html'));
  return (
    <>
      <WebView source={{ html: '<img src="logo.png">', baseUrl: 'https://example.com' }} />
      {assets?.[0]?.localUri && (
        <WebView
          source={{ uri: assets[0].localUri }}
          android={{ settings: { allowFileAccess: true } }}
        />
      )}
    </>
  );
}
```

## Page requests

### File inputs

```tsx
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

<WebView
  source={{ uri: 'https://example.com' }}
  onFileRequest={async ({ accept, multiple, capture }) => {
    if (capture) {
      const photo = await ImagePicker.launchCameraAsync();
      return photo.canceled ? null : photo.assets.map((asset) => asset.uri);
    }
    const mimeTypes = accept.filter((type) => type.includes('/')); // the picker takes MIME types, not `.pdf`
    const result = await DocumentPicker.getDocumentAsync({
      type: mimeTypes.length ? mimeTypes : '*/*',
      multiple,
    });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  }}
/>;
```

### Permissions

```tsx
import { Camera } from 'expo-camera';

<WebView
  source={{ uri: 'https://meet.example.com' }}
  onPermissionRequest={async ({ origin, resources }) => {
    if (origin !== 'https://meet.example.com') return false;
    if (resources.some((resource) => resource !== 'camera')) return false;
    return (await Camera.requestCameraPermissionsAsync()).granted;
  }}
/>;
```

### Fullscreen video

On Android, this lets a portrait-locked app rotate while a video is fullscreen.

```tsx
import * as ScreenOrientation from 'expo-screen-orientation';

<WebView
  source={{ uri: 'https://example.com' }}
  onFullscreenChange={({ active }) =>
    active
      ? ScreenOrientation.unlockAsync()
      : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
  }
/>;
```

### Downloads

`preview()` opens the file in Quick Look on iOS, and in an app that takes its type on Android.

```tsx
import { File } from 'expo-file-system';

<WebView
  source={{ uri: 'https://example.com' }}
  onDownload={(result) =>
    result.ok ? new File(result.uri).preview() : console.warn('download failed', result.kind)
  }
/>;
```

## Native hooks

The [native hooks guide](native-hooks.md) builds one, from module to `useExtensions`.
