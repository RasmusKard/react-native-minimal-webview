# The bridge

A promise bridge between React Native and the page, for the origins you allow.

```tsx
const bridge = useMemo(() => createBridge({ allowedOrigins: ['https://example.com', 'https://*.example.com'] }), []);
useEffect(
  () => bridge.handle('share', async (params) => { await Share.share({ url: (params as { url: string }).url, message }); return true }), // the unsubscribe
  [bridge, message]
);

<WebView bridge={bridge} … />
await bridge.call('getCartCount');   // a method the page registered
bridge.emit('themeChanged', 'dark');
```

Make the bridge once (`useMemo`): a new one recreates the WebView. One bridge serves one mounted WebView at a time;
attaching it to a second throws. Register a handler in an effect, with the values it uses in the deps; `handle` returns
the unsubscribe. A handler gets `(params, sender)` and an `on` listener `(payload, sender)`. `sender.origin` is the
calling page's origin as `location.origin` writes it (`https://shop.example.com:8443`), read by native code, not taken
from the page's message:

```tsx
bridge.handle('getToken', (_, { origin }) => {
  if (origin !== 'https://example.com') throw new Error('not for this origin');
  return token;
});
```

In the page:

```js
await window.nativeBridge.call('share', { url: location.href }, { timeoutMs: 0 }); // the share sheet waits on the user
window.nativeBridge.handle('getCartCount', () => cart.length);
window.nativeBridge.on('themeChanged', (theme) => applyTheme(theme));
```

**How it behaves:**
- **Errors are structured:** `{ code, message }`. The codes are `timeout`, `not_found`, `handler_error`, `navigated`, `unavailable` (see [Android System WebView](#android-system-webview)) and `invalid`.
- **Limits:** calls time out after 10 s by default (`createBridge({ timeoutMs })`); one call can set its own with `{ timeoutMs }`, from either side (`bridge.call(method, params, { timeoutMs })`, `nativeBridge.call(…)`), where `0` or `Infinity` means none. Messages have no size limit.
- **Page load:** calls and events from React Native wait until the page's DOM is parsed (`DOMContentLoaded`), so handlers and listeners registered by its synchronous or deferred scripts are in place. A page's own calls work earlier, and are answered at once.
- **One document:** every message is for one document, and never reaches the next page, even on the same origin. Calls in flight are rejected with `navigated` when the page navigates, its renderer crashes or the WebView unmounts (a page's own calls also when it comes back from the back-forward cache); events are dropped. The other side may already have handled such a call, so retry only calls that are safe to repeat.
- **Origins:** pages outside `allowedOrigins` get no `window.nativeBridge`, and nothing is delivered to them. Only the main frame takes part. Every allowed origin gets the same trust: any of them can call any handler, so a handler that is only for some origins checks `sender.origin`. The document token is for correctness, not security: the page's own client drops a message that isn't for its document, and an allowed page can rebind that client. A rule is `*` (any origin, opaque ones too), `https://example.com[:port]`, `https://*.example.com[:port]` (subdomains only, not `example.com`) or an IP literal such as `http://[::1]:8080`; http or https only, no path, ASCII (punycode) hosts. Case is ignored, and a missing port means 80 or 443.
- **Transports:** iOS uses a `WKScriptMessageHandler` plus `callAsyncJavaScript`; Android uses `addWebMessageListener` with origin rules.

## Android System WebView

The bridge and `injectedScripts` need the WebView's `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT` features, and
`evaluate` (and so `blob:` downloads) needs `WEB_MESSAGE_LISTENER`. Both are in WebView 101 and newer, so any API 29+
device with WebView updates enabled has them. Without them, bridge calls reject with `unavailable` and injected
scripts don't run, and the library warns once per process, in every build.

## Pages written for react-native-webview

Pages that call `window.ReactNativeWebView.postMessage(string)` and listen for `message` events keep working through
the bridge. Only `allowedOrigins` get `ReactNativeWebView`, and only in the main frame; react-native-webview gives it
to every page and every iframe.

```tsx
const rnwMessages = {
  // Runs after the bridge's own script, so `window.nativeBridge` already exists.
  code: `if (window.nativeBridge) {
    window.ReactNativeWebView = { postMessage: (data) => window.nativeBridge.emit('rnw', String(data)) };
    window.nativeBridge.on('rnw', (data) =>
      ${Platform.OS === 'ios' ? 'window' : 'document'}.dispatchEvent(new MessageEvent('message', { data })));
  }`,
} as const;

<WebView bridge={bridge} injectedScripts={[rnwMessages]} … />

useEffect(() => bridge.on('rnw', (data) => handleMessage(data as string)), [bridge]); // was onMessage
bridge.emit('rnw', message); // was ref.current.postMessage(message)
```

The `message` event goes to `window` on iOS and `document` on Android, as react-native-webview sends it.

## Scroll position

There is no `onScroll` prop. An injected script reports the main frame's scroll position over the bridge, at most once
per frame:

```tsx
const scroll = {
  code: `let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; window.nativeBridge?.emit('scroll', { x: scrollX, y: scrollY }); });
  }, { passive: true });`,
} as const;

<WebView bridge={bridge} injectedScripts={[scroll]} … />
useEffect(() => bridge.on('scroll', (position) => onScroll(position as { x: number; y: number })), [bridge]);
```

Only pages in `allowedOrigins` report. For offsets during a bounce or a pinch, a [native hook](native-hooks.md) can
observe `scrollView.contentOffset` on iOS and `setOnScrollChangeListener` on Android.
