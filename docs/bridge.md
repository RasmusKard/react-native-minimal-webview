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
- **Errors are structured:** a call rejects with a `BridgeCallError`, an `Error` whose `code` is a `BridgeErrorCode`: `timeout`, `not_found` (no handler), `handler_error` (the handler threw or rejected; `message` is its error's), `navigated` or `unavailable` (an Android WebView older than 101, see [Android System WebView versions](props.md#android-system-webview-versions)). Catch it with `(error as BridgeCallError).code`.
- **Limits:** calls time out after 10 s by default (`createBridge({ timeoutMs })`); one call can set its own with `{ timeoutMs }`, from either side (`bridge.call(method, params, { timeoutMs })`, `nativeBridge.call(…)`), where `0` or `Infinity` means none. Messages have no size limit.
- **Page load:** calls and events from React Native wait until the page's DOM is parsed (`DOMContentLoaded`), so handlers and listeners registered by its synchronous or deferred scripts are in place. A page's own calls work earlier, and are answered at once.
- **One document:** every message is for one document, and never reaches the next page, even on the same origin. Calls in flight are rejected with `navigated` when the page navigates, its renderer crashes or the WebView unmounts (a page's own calls also when it comes back from the back-forward cache); events are dropped. The other side may already have handled such a call, so retry only calls that are safe to repeat.
- **Origins:** pages outside `allowedOrigins` get no `window.nativeBridge`, and nothing is delivered to them. Only the main frame takes part. Every allowed origin gets the same trust: any of them can call any handler, so a handler that is only for some origins checks `sender.origin`. The document token is for correctness, not security: the page's own client drops a message that isn't for its document, and an allowed page can rebind that client. A rule is `*` (any origin, opaque ones too), `https://example.com[:port]`, `https://*.example.com[:port]` (subdomains only, not `example.com`) or an IP literal such as `http://[::1]:8080`; http or https only, no path, ASCII (punycode) hosts. Case is ignored, and a missing port means 80 or 443.
- **Transports:** iOS uses a `WKScriptMessageHandler` plus `callAsyncJavaScript`; Android uses `addWebMessageListener` with origin rules.

## Typing the bridge

`createBridge<Methods, Events>` types the method names, params, results and event payloads of `call`, `handle`,
`emit` and `on`. It is type-only: nothing checks a message at runtime, so a handler still validates what a page sends
if it doesn't trust it. Without type arguments everything is `unknown`. One map covers both directions, so name a
method once whichever side handles it. Write the maps as `type`s: an `interface` doesn't satisfy `BridgeMethodMap`.

```tsx
type Methods = {
  share: { params: { url: string }; result: boolean }; // handled in React Native
  getCartCount: { result: number }; // handled by the page
};
type Events = { themeChanged: 'light' | 'dark' };

const bridge = useMemo(() => createBridge<Methods, Events>({ allowedOrigins: ['https://example.com'] }), []);
useEffect(() => bridge.handle('share', async ({ url }) => (await Share.share({ url })).action === Share.sharedAction), [bridge]);
const count = await bridge.call('getCartCount'); // number
bridge.emit('themeChanged', 'dark');
```

### Page types

The page client has the same four methods, untyped. For a TypeScript page:

```ts
declare global {
  interface Window {
    /** Only on an allowed origin, in the main frame. */
    nativeBridge?: {
      /** Rejects with an `Error` whose `code` is one of the bridge's error codes. */
      call(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
      /** Returns the unsubscribe. */
      handle(method: string, handler: (params: unknown) => unknown): () => void;
      emit(event: string, payload?: unknown): void;
      /** Returns the unsubscribe. */
      on(event: string, listener: (payload: unknown) => void): () => void;
    };
  }
}
```

## Pages written for react-native-webview

`window.ReactNativeWebView.postMessage` and `message` events through the bridge: see
[Migrating from react-native-webview](migrating-from-react-native-webview.md#postmessage-and-onmessage).

## Scroll position

There is no `onScroll` prop: an injected script reports it over the bridge, see the
[recipe](migrating-from-react-native-webview.md#scroll-position).
