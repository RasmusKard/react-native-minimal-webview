# Navigation state

```tsx
import { useRef } from 'react';
import { WebView, useWebViewState, type WebViewRef } from 'minimal-rn-webview';

export function Browser() {
  const ref = useRef<WebViewRef>(null);
  const { url, loading, canGoBack } = useWebViewState(ref);
  return <WebView ref={ref} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

`useWebViewState(ref)` gives `url`, `pendingUrl`, `title`, `loading`, `progress`, `canGoBack`, `canGoForward` and
`outcome`, and re-renders with each change.

## Outside React

For code outside React, such as a push notification handler, create the ref with `createWebViewRef()` at module level
and pass it as `ref`. It works with `useWebViewState` too.

```tsx
import { WebView, createWebViewRef } from 'minimal-rn-webview';

export const webView = createWebViewRef();

function onInboxNotification() {
  if (webView.getState().url.startsWith('https://example.com/inbox')) webView.current?.reload();
}

export function Browser() {
  return <WebView ref={webView} source={{ uri: 'https://example.com' }} style={{ flex: 1 }} />;
}
```

Give each mounted WebView its own ref. If two are mounted with the same one, the last mounted wins (with a warning in
development) until it unmounts.
