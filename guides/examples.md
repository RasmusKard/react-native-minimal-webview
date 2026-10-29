---
title: Examples
---

# Examples

One example per public interface. What each prop, method and type does is in its TSDoc, generated into the
[API reference](https://rasmuskard.github.io/minimal-rn-webview/modules.html).

## Navigation state

```tsx
import { useRef } from 'react';
import { WebView, useWebViewState, type WebViewRef } from 'minimal-rn-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const { url, loading, canGoBack } = useWebViewState(ref);
  return (
    <>
      <Button title="back" disabled={!canGoBack} onPress={() => ref.current?.goBack()} />
      <WebView ref={ref} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />
    </>
  );
}
```

Android's back button is the app's: `goBack()` from a `BackHandler`.

```tsx
useEffect(() => {
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    if (!canGoBack) return false;
    ref.current?.goBack();
    return true;
  });
  return () => subscription.remove();
}, [canGoBack]);
```

Outside React (a push notification handler), `createWebViewRef()` makes the ref at module level:

```tsx
export const webView = createWebViewRef();

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
    { host: ['pay.example.com'], action: 'ask' }, // onNavigationRequest decides, within 1 s
    { host: ['example.com', '*.example.com'], action: 'allow' },
    { scheme: ['http', 'https'], mainFrame: false, action: 'allow' }, // iframes
    { mainFrame: true, action: 'external' }, // other sites, tel: and mailto: links, new windows; a subframe's is blocked
  ]}
  onNavigationRequest={({ url }) => (isTrusted(url) ? 'allow' : 'external')}
  onNavigation={({ url, action, rule }) => console.log(action, url, rule)}
/>
```

## The bridge

```tsx
type Methods = {
  share: { params: { url: string }; result: boolean }; // handled in React Native
  getCartCount: { result: number }; // handled by the page
};
type Events = { themeChanged: 'light' | 'dark' };

const bridge = useMemo(() => createBridge<Methods, Events>({ allowedOrigins: ['https://example.com'] }), []); // once: a new one recreates the WebView
useEffect(
  () => bridge.handle('share', async ({ url }, { origin }) => (await Share.share({ url })).action === Share.sharedAction), // returns the unsubscribe
  [bridge]
);
<WebView bridge={bridge} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;

const count = await bridge.call('getCartCount');
bridge.emit('themeChanged', 'dark');
```

In the page:

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
<WebView
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

const bounces = await ref.current?.get('scrollView.bounces'); // iOS; 'settings.textZoom' on Android
// Android: a public method of settings, webView, cookieManager or webStorage
await ref.current?.call('webView.clearCache', [true]);
await ref.current?.call('cookieManager.removeAllCookies', [null]);
// iOS: an Objective-C selector; a trailing completion handler needs its shape
await ref.current?.call('scrollView.setContentOffset:animated:', [{ x: 0, y: 200 }, true]);
await ref.current?.call(
  'websiteDataStore.removeDataOfTypes:modifiedSince:completionHandler:',
  [{ set: [IOSConstants.WebsiteDataType.cookies, IOSConstants.WebsiteDataType.localStorage] }, { date: 0 }],
  { completion: 'void' }
);
const png = await ref.current?.call('webView.takeSnapshotWithConfiguration:completionHandler:', [null], { completion: 'valueError' }); // base64
```

## Scripts

```tsx
<WebView injectedScripts={[{ code: `window.config = ${JSON.stringify(config)}` }]} … />; // at document start, before the page's scripts

const title = await ref.current?.evaluate('document.title'); // an expression, not statements
await ref.current?.evaluate(`(() => { document.body.style.background = 'red'; })()`);
```

## Page requests

Each works without its prop; the prop answers it or is told afterwards.

```tsx
<WebView
  // <input type="file">, Android (iOS shows WebKit's picker): expo-image-picker for the camera, expo-document-picker else
  onFileRequest={async ({ accept, multiple, capture }) => {
    if (capture) {
      const photo = await ImagePicker.launchCameraAsync();
      return photo.canceled ? null : photo.assets.map((asset) => asset.uri);
    }
    const mimeTypes = accept.filter((type) => type.includes('/')); // the picker takes MIME types, not `.pdf`
    const result = await DocumentPicker.getDocumentAsync({ type: mimeTypes.length ? mimeTypes : '*/*', multiple });
    return result.canceled ? null : result.assets.map((asset) => asset.uri);
  }}
  // Ask the OS first (expo-camera), then grant
  onPermissionRequest={async ({ origin, resources }) => {
    if (origin !== 'https://meet.example.com' || !resources.every((resource) => resource === 'camera')) return false;
    return (await Camera.requestCameraPermissionsAsync()).granted;
  }}
  // Fullscreen video (Android): let a portrait-locked app rotate, with expo-screen-orientation
  onFullscreenChange={({ active }) =>
    active ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
  }
  // A download: open it (expo-file-system; Quick Look on iOS, an app on Android) or share it (expo-sharing)
  onDownload={(result) => (result.ok ? new File(result.uri).preview() : console.warn('download failed', result.kind))}
/>
```

## Native hooks

Anything the settings can't express is a few lines of Swift or Kotlin in your own Expo module (a
[local module](https://docs.expo.dev/modules/get-started/), `npx create-expo-module@latest --local`, or a package): a
hook gets the real `WKWebView` or `WebView` and chains its own delegates and clients. The module depends on this one:
`s.dependency 'MinimalWebView'` in its podspec and `implementation project(':minimal-rn-webview')` in its
`build.gradle`. `example/modules/sample-extension` is a complete one.

```swift
// iOS, in your module's OnCreate
MinimalWebViewHooks.register("myPackage.pageCounter", configure: { configuration, context in // before the WKWebView exists
  configuration.dataDetectorTypes = .phoneNumber
}) { webView, context in // once it exists; returns a detach closure, or nil
  let counter = PageCounter(context: context) // a WKNavigationDelegate
  context.navigationDelegates.append(counter)
  context.handle("count") { args, reply in reply(counter.count) }
  context.onDocumentEnd { reason in counter.pageEnded() }
  return nil
}
```

```kotlin
// Android, in your module's OnCreate
MinimalWebViewHooks.register("myPackage.pageCounter") { webView, context -> // each WebView: the first, and any after a crash
  context.clients += PageCounter(context) // a WebViewClient
  null // or { … }, run when it goes away
}
```

```tsx
<WebView hookOptions={{ 'myPackage.pageCounter': { label: 'a' } }} onHookEvent={({ name, payload }) => …} />; // the key enables the hook
await ref.current?.hook('myPackage.pageCounter', 'count'); // the handler's reply
```
