# Navigation state

```tsx
import { useRef } from 'react';
import { WebView, useWebViewState, type WebViewRef } from 'react-native-minimal-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const { url, loading, canGoBack } = useWebViewState(ref);
  return <WebView ref={ref} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

`useWebViewState(ref)` gives `url`, `pendingUrl`, `title`, `loading`, `progress`, `canGoBack`, `canGoForward` and
`outcome`, and re-renders with each change.

- `url` is the page on screen. It changes when a load commits and on SPA navigation (pushState, replaceState, hash).
  After a failed load it is the failed URL.
- `pendingUrl` is a main-frame load in progress, which may still fail or be blocked.
- `outcome` is how the last load ended, `finished`, `failed` or `cancelled`, and `null` while one is loading (and
  before the first). `onLoadEnd` gets it with the state. See [`onLoadStart`, `onLoadEnd`](props.md) for what counts as
  which.
- Iframes never change `url` or `pendingUrl`.
- On Android with a WebView older than 146, `pendingUrl` stays `null`; `url` still follows commits and SPA navigation
  ([Android System WebView versions](props.md#android-system-webview-versions)).

The hook follows the WebView when it remounts (a new `key`, a conditional render). While no WebView is mounted with
the ref, the state is the initial one (`url: ''`), so a stale `url` never looks valid.

## Outside React

For code outside React, such as a push notification handler, create the ref with `createWebViewRef()` at module level
and pass it as `ref`:

```tsx
import { WebView, createWebViewRef } from 'react-native-minimal-webview';

export const webView = createWebViewRef();

function onInboxNotification() {
  if (webView.getState().url.startsWith('https://example.com/inbox')) webView.current?.reload();
}

export function Browser() {
  return <WebView ref={webView} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

It works with `useWebViewState` too, and has:

- `current`: the mounted WebView's [ref methods](props.md#ref-methods), or `null` while none is mounted.
- `getState()`: the navigation state, synchronously.
- `subscribe(listener)`: called on every change, including a WebView mounting or unmounting. Subscribers stay across
  remounts. Returns the unsubscribe function.

Give each mounted WebView its own ref. If two are mounted with the same one, the last mounted wins (with a warning in
development) until it unmounts.
